# PrismReview 系统架构

> 本文档描述 PrismReview 后端的技术架构：模块化单体、自研 graph 编排脊柱、Moderator 决策流、五态 providerSource 与数据模型。面向开发者的"如何工作"说明，与 `README.md`（用户向）互补。

---

## 1. 系统概览

PrismReview 是一个 **多 Agent 智能评审中枢（Multi-Agent Review Board）**：把一份方案交给一组专家 Agent，经过多轮并行评审与辩论，由 Moderator 收敛产出正式评审报告。

当前形态是**模块化单体（modular monolith）**，不拆微服务：

- `apps/web` — Next.js 14 + React 18 前端（评审控制台、会议室、报告页）。
- `apps/api` — NestJS 10 后端，承载全部编排逻辑与持久化。
- 基础设施由 `docker compose` 提供：PostgreSQL 16（主库 + checkpoint）、Redis 7（缓存/队列）、MinIO（artifact 存储）。

设计原则：**默认全 mock，真模型非默认**。任何真实 LLM 调用都必须显式 env + Gate 才启用，且 dev-only 有数量上限。

---

## 2. 后端模块分层

`apps/api` 内部以有界模块组织，关键模块：

- **ReviewsModule** — 评审生命周期入口（REST + SSE Gateway）。
- **ReviewOrchestrator**（在 `reviews/orchestrator/`）— graph 脊柱 + Moderator 逻辑，**包装**既有 `QueueService`，而非替换。
- **QueueService** — 既有内存 mock 队列，负责 turn 派发与 DB 幂等。
- **RolesModule / KnowledgeModule** — 专家角色版本化、知识库。
- **ReportingService / ArtifactService** — 报告聚合与 Markdown 导出。

`AgentRuntime` 独立 worker 进程抽取列入 **P6**，目前 turn 执行仍在 `apps/api` 进程内，仅结构化上脊柱。

---

## 3. 编排脊柱详解

### 3.1 七状态机

评审会状态由显式状态机驱动（代码见 `reviews.service.ts` 的 `REVIEW_STATUS_FLOW`）：

```
   created ──▶ diagnosed ──▶ running ──▶ summarized ──┐
                            ▲                          │
                            │        continue_debate   │
                            └──────────────────────────┘
   summarized ──▶ completed
   (any)      ──▶ failed
   (any)      ──▶ aborted        ← max_rounds / 收敛硬闸

   补充保留态（非规范 happy-path）：
     interrupted  → HITL 暂停，可恢复 → running
     archived     → 终态后生命周期归档标志
```

规范集 7 态：`created → diagnosed → running → summarized → completed / failed / aborted`。`running(r1)` 为并行 reviewer turns，`summarized` 后 Moderator 可进入 `running(r2)` 辩论，轮次上界由 `max_rounds` 硬闸兜底。

### 3.2 graph runtime（自研最小 TS runtime）

范式对齐 LangGraph（显式状态机 + checkpoint + 条件路由），但**自研**，不引入 `@langchain/langgraph` 全量依赖。核心类型（`orchestrator/graph-runtime.ts`）：

```ts
type Node<S extends ReviewState> =
  (state: Readonly<S>, ctx: NodeCtx) => Promise<Partial<S>>;

type Edge = StaticEdge | ConditionalEdge;
// StaticEdge: { kind:'static', from, to }
// ConditionalEdge: { kind:'conditional', from, route: (s)=>string }

interface Graph<S extends ReviewState> {
  nodes: Record<string, Node<S>>;
  edges: readonly Edge[];
  start: string;
}

interface Checkpointer {
  save(reviewId: string, nodeId: string, state: ReviewState): Promise<Checkpoint>;
  load(reviewId: string): Promise<{ nodeId: string; state: ReviewState } | null>;
}

interface ReviewState {
  reviewId: string; status: ReviewStatus; round: number;
  currentNodeId: string; turns: TurnRecord[];
  moderatorDecisions: ModeratorDecisionRef[]; usage: UsageLedger;
  convergenceScore?: number; lastDecisionType?: ModeratorDecisionType;
}
```

`NodeCtx` 注入 `logger` / `checkpointer` / `queue` / `prisma`；`modelAdapter` / `memoryService` / `promptService` 为 **P2/P3 注入位**，P1 传 `undefined`，节点内部判空。

### 3.3 checkpoint / resume

每节点转移后，`Checkpointer.save(reviewId, nodeId, state)` 将 `ReviewState` 序列化进 `ReviewCheckpoint`（`stateJson` + 单调递增 `sequence`）。进程崩溃后 `load(reviewId)` 取 `sequence` 最大者恢复，实现 **resume**，不重跑已完成 turn。

---

## 4. Moderator 决策流

Moderator 是带**硬闸**的 LLM Agent（P1 为 mock 实现，按预置规则推进，不调真实 LLM）。每轮 `summarized` 后，它依据收敛信号与硬闸产出一条 `ModeratorDecision`：

- `advance_round` — 进入下一轮并行评审
- `continue_debate` — 进入 round-2 辩论（mock debater 确定性生成）
- `converge` — 收敛达标，产出报告
- `force_stop` — 触顶 `max_rounds` 或预算，强停
- `terminate_proposal` — 终止提议

硬闸（代码强制，LLM 不可覆盖）：`max_rounds`（默认 3）、`max_turns_per_reviewer`（泛化既有 `MODEL_PILOT_MAX_ROLES=3`）、`max_tokens_per_review`、`max_cost_per_review`（P2 生效，P1 恒 0）。`min_rounds` 之后若收敛分低于阈值可强停；LLM 反对须过 sanity check 才放行。每条决策 + 推理 + 校验结果落 `ModeratorDecision` 审计表。

---

## 5. 五态 providerSource

每条 opinion 的来源通过 `modelOutputRef.providerSource` 追踪，共 5 态：

| 值 | 含义 |
|----|------|
| `mock` | 默认 mock provider |
| `lmstudio` | 本地 LM Studio（dev-only，≤3 capped） |
| `openai_compatible` | 付费 OpenAI-compatible API（gated） |
| `fallback_mock` | 真模型失败回退至 mock |
| `failed` | 调用/校验失败 |

`Report.providerSummary` 按此聚合（`bySource` + `hasRealProvider` + `fallbackCount` + `failedCount`），实现**来源可观测性（provenance）**。

---

## 6. 数据模型关系

核心实体（`schema.prisma`）：

```
Tenant 1─* User
Tenant 1─* AgentRole 1─* AgentRoleVersion
Review 1─* ReviewTurn 1─* ReviewOpinion
Review 1─1 Report 1─* ActionItem
Review 1─* ReviewCheckpoint      (resume 锚点)
Review 1─* ModeratorDecision     (审计)
```

P1 additive：`Review` 加 `currentRound` / `currentNodeId`；`ReviewTurn` 加 `round` / `idempotencyKey`（`${reviewId}::${roleVersionId}::${round}`，唯一） / `schemaVersion`；新增 `ReviewCheckpoint` 与 `ModeratorDecision` 表。Turn 幂等键保证对已完成 turn 重跑命中 skip。

---

## 7. 观测性（Observability）

- **结构层**：`ModeratorDecision` 审计 + `ReviewCheckpoint` 提供决策与状态可追溯。
- **来源层**：`providerSummary` 五态来源聚合，区分 mock / 真模型 / 回退 / 失败。
- **链路层（P6）**：预留 `NodeCtx.tracer` 接口，未来接 OTel 全链路 span（目前为 stub）。

---

## 8. 扩展点（Extension Points）

| 扩展 | 阶段 | 接口位 |
|------|------|--------|
| 真 LLM Moderator | P2/P3 | `Moderator` 接口位（P1 mock 实现） |
| Model Adapter 泛化 | P2 | `NodeCtx.modelAdapter?` |
| Reviewer/Project Memory | P3 | `NodeCtx.memoryService?` |
| 版本化 Prompt | P3 | `NodeCtx.promptService?` |
| MCP 工具 / HITL | P4 | 条件边 + 中断节点 |
| AgentRuntime worker | P6 | 独立进程抽取，复用现有 Queue 模式 |

任一模块接口干净，未来可独立抽成服务而**不重写**脊柱。
