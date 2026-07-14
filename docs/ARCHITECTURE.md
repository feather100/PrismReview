# PrismReview 系统架构

> 本文档描述 PrismReview 后端的技术架构：模块化单体、自研 graph 编排脊柱、AI Moderator 决策流、五态 providerSource、加权评分引擎、RBAC 与审计、数据模型。面向开发者的"如何工作"说明，与 `README.md`（用户向）互补。

---

## 1. 系统概览

PrismReview 是一个 **多 Agent 智能评审中枢（Multi-Agent Review Board）**：把一份方案交给一组专家 Agent，经过多轮并行评审与辩论，由 AI Moderator 收敛产出正式评审报告。

当前形态是**模块化单体（modular monolith）**，不拆微服务：

- `apps/web` — Next.js 14 + React 18 前端（评审控制台、会议室、报告页）。
- `apps/api` — NestJS 10 后端（~8,100 LOC），承载全部编排逻辑与持久化。
- 基础设施由 `docker compose` 提供：PostgreSQL 16（主库 + checkpoint）、Redis 7（缓存/队列）、MinIO（artifact 存储）。

设计原则：**默认全 mock，真模型非默认**。任何真实 LLM 调用都必须显式 env + Gate 才启用，且 dev-only 有数量上限。

**P1–P5 完整收官**：编排脊柱 / Model Adapter / Prompt+Memory / Tool+HITL / Workflow+评分 全部落地。

---

## 2. 后端模块分层

`apps/api` 内部以有界模块组织（共 10 个模块）：

| 模块 | 路径 | 职责 | Sprint |
|------|------|------|--------|
| **reviews** | `modules/reviews/` | 评审生命周期入口 + orchestrator + 5 子模块 | P1–P5 |
| **orchestrator** | `modules/reviews/orchestrator/` | graph 脊柱 + Moderator (Mock / LLM) | P1 / P4 |
| **queue** | `modules/reviews/queue/` | 内存 mock 队列 + turn 派发 + DB 幂等 | P1 |
| **provider** | `modules/reviews/provider/` | ModelAdapter 抽象 + factory（mock/longcat/lmstudio/openai_compatible）| P2 |
| **prompt** | `modules/prompt/` | 版本化 PromptService（4 层组装）| P3 |
| **memory** | `modules/memory/` | Reviewer/Project 蒸馏 profile + rolling summary | P3 |
| **tool** | `modules/tool/` | MCP-only ToolRegistry（mock stub）+ 审批状态机 | P4 |
| **workflow** | `modules/workflow/` | 4 种 preset 配置（enterprise/code-review/research/thesis）| P5 |
| **scoring** | `modules/reviews/scoring/` | 加权多维评分引擎 + verdict 阈值 + audit snapshot | P5 |
| **reporting** | `modules/reviews/reporting/` | 报告生成 + Markdown 导出 + 评分小节 | P5 |
| **audit** | `modules/audit/` | 审计日志读 API（GET /audit/logs）| Sprint 5.0 |
| **auth** | `modules/auth/` | RBAC 权限映射 + AuthService | Sprint 5.0 |
| **users** | `modules/users/` | 用户管理 CRUD（租户内）| Sprint 5.0 |
| **roles** | `modules/roles/` | AgentRole 版本化管理 | Sprint 2.x |
| **knowledge** | `modules/knowledge/` | KB 文档 + Chunk + 接口位（RAG P4 预留）| P3 |

---

## 3. 编排脊柱详解

### 3.1 状态机（9 值）

评审会状态由显式状态机驱动（代码见 `reviews.service.ts` 的 `REVIEW_STATUS_FLOW`）：

```
   created ──▶ diagnosed ──▶ running ──▶ summarized ──┐
                            ▲                          │
                            │        continue_debate   │
                            └──────────────────────────┘
   summarized ──▶ completed / aborted / failed
   running    ──▶ interrupted (HITL 暂停, 可恢复 → running)
   (any)      ──▶ archived (终态后归档标志)
```

规范集 7 态：`created → diagnosed → running → summarized → completed / failed / aborted`。`running(r1)` 为并行 reviewer turns，`summarized` 后 Moderator 可进入 `running(r2)` 辩论，轮次上界由 `max_rounds` 硬闸兜底。

### 3.2 graph runtime（自研最小 TS runtime）

范式对齐 LangGraph（显式状态机 + checkpoint + 条件路由），但**自研**，不引入 `@langchain/langgraph` 全量依赖。核心类型（`orchestrator/graph-runtime.ts`）：

```ts
type Node<S extends ReviewState> = (state: Readonly<S>, ctx: NodeCtx) => Promise<Partial<S>>;
type Edge = StaticEdge | ConditionalEdge;

interface Graph<S> { nodes: Record<string, Node<S>>; edges: readonly Edge[]; start: string; }
interface ReviewState {
  reviewId: string; status: ReviewStatus; round: number;
  currentNodeId: string; turns: TurnRecord[];
  moderatorDecisions: ModeratorDecisionRef[]; usage: UsageLedger;
  convergenceScore?: number; lastDecisionType?: ModeratorDecisionType;
  pendingToolCalls?: string[];   // P4: tool_node 消费
}
```

`NodeCtx` 注入 `logger` / `checkpointer` / `queue` / `prisma` / `modelAdapter`（P2）/ `promptService`（P3）/ `memoryService`（P3）/ `knowledgeService`（P3）；`tracer` 为 P6 OTel 预留位。

### 3.3 checkpoint / resume

每节点转移后，`Checkpointer.save(reviewId, nodeId, state)` 将 `ReviewState` 序列化进 `ReviewCheckpoint`（`stateJson` + 单调递增 `sequence`）。进程崩溃后 `load(reviewId)` 取 `sequence` 最大者恢复，实现 **resume**，不重跑已完成 turn。

---

## 4. Moderator 决策流

Moderator 是带**硬闸**的 AI Agent。P1 默认 MockModerator（确定性规则），P4 新增 LlmModerator（真 LLM，env-gated，失败降级 MockModerator）。

每轮 `summarized` 后，它依据收敛信号与硬闸产出一条 `ModeratorDecision`：

| 决策类型 | 触发条件 |
|----------|----------|
| `advance_round` | minRounds 未达标 |
| `continue_debate` | 存在 high-risk 冲突 |
| `converge` | 收敛达标 |
| `force_stop` | 触顶 `max_rounds` 或预算 |
| `terminate_proposal` | LLM 提终止提议 |
| `tool_approval` | P4: 工具调用需 Moderator 审批 |

**硬闸（代码强制，LLM 不可覆盖）**：`max_rounds`（默认 3）、`max_turns_per_reviewer`（泛化 `MODEL_PILOT_MAX_ROLES=3`）、`max_tokens_per_review`、`max_cost_per_review`。`minRounds` 之后若收敛分低于阈值可强停；LLM 反对须过 sanity check 才放行。每条决策 + 推理 + 校验结果落 `ModeratorDecision` 审计表。

LlmModerator（P4）新增：
- `narrate(state)` — LLM 生成本轮汇总叙事（ReportingService 使用）
- `proposeTools(state)` — LLM 提议本回合可用工具（按 workflow.availableTools 过滤）
- `sanityCheck(reason, state)` — 反对理由须引用具体维度名/冲突字段才放行
- `decide(state, gates, config)` — LLM JSON 决策 + 代码硬闸覆盖

---

## 5. 五态 providerSource

每条 opinion 的来源通过 `modelOutputRef.providerSource` 追踪，共 5 态：

| 值 | 含义 |
|----|------|
| `mock` | 默认 mock provider |
| `lmstudio` | 本地 LM Studio（dev-only，≤3 capped） |
| `openai_compatible` | OpenAI-compatible API（gated，含 LongCat） |
| `longcat` | LongCat-2.0（经 OpenAICompatibleAdapter）|
| `fallback_mock` | 真模型失败回退至 mock |
| `failed` | 调用/校验失败 |

`Report.providerSummary` 按此聚合（`bySource` + `hasRealProvider` + `fallbackCount` + `failedCount`），实现**来源可观测性（provenance）**。

---

## 6. 加权多维评分（P5）

评分引擎（`ScoringService`）驱动 verdict：

```
overallScore = Σ (confidenceAvg[d] × riskPenalty[d] × weight[d]) × 100
```

- **维度权重** — 来自 `workflow.scoringWeights.byDimension`（未指定 → fallback uniform/confidence/risk）
- **风险惩罚** — high → ×0.5 / medium → ×0.8 → low/info ×1.0
- **阈值判定** — `overallScore >= thresholds.approved` → approved；`>= conditionallyApproved` → conditionally_approved；否则 rejected
- **审计快照** — 评分时 snapshot 权重 + 各维度得分 → `Review.scoringConfig` Json 列
- **覆盖率审计** — `coverage.expected / covered / missing` 标注未覆盖的预期维度

4 种 preset workflow（`WorkflowRegistry`）：

| preset | 中文 | 特色维度 | 轮次预设 |
|--------|------|----------|----------|
| `enterprise` | 企业评审 | 架构 / 投入产出 / 交付 / 合规 / 体验 | 3 轮 |
| `code-review` | 代码审查 | 代码质量 / 安全 / 性能 / 可维护性 | 2 轮 |
| `research` | 科研评审 | 创新性 / 可行性 / 科学价值 / 方法论 | 3 轮 |
| `thesis` | 论文评审 | 原创性 / 技术深度 / 写作质量 / 实验设计 | 2 轮 |

---

## 7. RBAC + 审计（Sprint 5.0）

**4 级平台角色**：

| 角色 | 权限 |
|------|------|
| `super_admin` | 全部（含 tenant.manage + admin.access + audit.read）|
| `enterprise_admin` | 读全部 + role.write + admin.access + audit.read |
| `department_admin` | 本部门 + role.write |
| `user` | 自有 review + role.read |

**权限粒度**：review.create / review.read.owned / review.read.all / review.read.department / role.read / role.write / role.delete / kb.* / audit.read / admin.access

`@RequirePermissions(...)` 装饰器（OR 语义）+ `PermissionsGuard` 全局注册 + `JwtAuthGuard`（enterprise_admin mock 用户默认）。

审计日志（`AuditInterceptor`）：所有 POST/PATCH/DELETE 自动写 `AuditLog` 表。GET /audit/logs 租户隔离（super_admin 例外）。

---

## 8. HITL + Tool（P4）

**3 种 HITL 场景**：

| 触发方 | 行为 |
|--------|------|
| 用户 (`POST /interrupt`) | 真正暂停 orchestrator（当前 turn 完成后 park）|
| Moderator tool_approval | 工具调用中断（可选人工确认）|
| Human Turn (`POST /meetings`) | 用户直接提交意见（`source='human'`），interrupted 态自动 resume |

**HITL 超时兜底（P5 修复）**：INTERRUPT_TIMEOUT_MS（默认 120s）后自动 resume + 审计标记。

**Tool 策略**：工具仅经 MCP 协议；A2A 禁止（reviewer 不调工具）；Moderator 工具审批 + ToolCallRequest 状态机（pending → executing → completed/failed/denied）。默认 mock ToolRegistry 返回 stub。

---

## 9. 数据模型关系

核心实体（`schema.prisma` ~13 表 + 10 index）：

```
Tenant 1─* User 1─* Review
Tenant 1─* AgentRole 1─* AgentRoleVersion
Review 1─* ReviewTurn 1─* ReviewOpinion   (+ promptRefs, source)
Review 1─1 Report 1─* ActionItem
Review 1─* ReviewCheckpoint      (resume 锚点)
Review 1─* ModeratorDecision     (audit, + proposedTools, llmRawOutput, sanityCheckResult)
Review 1─* ReviewerMemory        (蒸馏 profile, 跨 review)
Review 1─* ProjectMemory         (项目级知识)
Review.* ─* PromptTemplateRecord  (version, layer)
Review.* ─* ToolCallRequest       (审批日志)
ToolDefinitionRecord              (MCP 工具定义)
AuditLog, BusinessEvent           (审计 + 业务事件)
User, Department                  (RBAC + 租户)
KnowledgeDocument / KnowledgeChunk (KB, RAG 接口位)
```

---

## 10. 内存安全（P5 修复）

| 机制 | 触发 | 行为 |
|------|------|------|
| `cleanupReview(reviewId)` | 终态（completed/aborted/force_stop）| 删 runningReviews + 清 processedIds + 清 HITL timer |
| `scheduleInterruptTimeout(reviewId)` | interrupt 时 | 120s 后自动 resume |
| `onModuleDestroy()` | 进程退出 | 清全部 timers + Maps |

---

## 11. 观测性（Observability）

- **结构层**：`ModeratorDecision` 审计 + `ReviewCheckpoint` 提供决策与状态可追溯。
- **来源层**：`providerSummary` 五态来源聚合。
- **评分层**：`scoringConfig` Json snapshot + coverage.missing 维度覆盖。
- **审计层**：`AuditLog`（全写操作）+ `BusinessEvent`（业务事件）。
- **链路层（P6）**：预留 `NodeCtx.tracer` 接口，未来接 OTel 全链路 span（目前为 stub）。

---

## 12. 扩展点（Extension Points）

| 扩展 | 阶段 | 接口位 |
|------|------|--------|
| AgentRuntime worker | P6 | 独立进程抽取，复用现有 Queue 模式 |
| 真 MCP server | P4 已预留接口 | `ToolRegistry.executeTool()` → MCP SDK 替换 mock stub |
| 用户自定义 workflow | V2 | `WorkflowRegistry.validateCustom()` + preset 表 |
| OTel 全链路 | P6 | `NodeCtx.tracer` |
| 成本看板 | V2 | `ReviewTurn.modelOutputRef.usage` + 聚合 |
| 实时流式评分 | V2 | SSE `/report/stream` |

任一模块接口干净，未来可独立抽成服务而**不重写**脊柱。

---

> 架构总览图见 `README.md` §架构。全栈审查见 `docs/coordination/Sprint_6.0_Full_Stack_Review_Report.md`（167 个回归 + 38 个专项 = **205 测试场景全绿**）。
