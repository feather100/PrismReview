# Sprint 9.1 — P1 Orchestrator Spine Contract

> **角色**：workbuddy-docs（纯文档，fast-gate）
> **模式**：快速 Gate（协议 §7.1 — 纯文档、不改 schema/状态机实现/模型/前端/依赖）
> **架构权威**：`docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md`（§2 三项决策、§3 graph 脊柱、§4 Moderator 硬闸、§5 九模块、§12 P1 范围）
> **基线**：Sprint 9.0 Go（commit `bbed578`）
> **日期**：2026-07-13
> **Owner**：workbuddy-docs
> **目的**：把 9.0 锁定的 P1 范围（§12）展开为**可实现的 Backend Contract**：状态机、graph runtime 接口、turn schema、Moderator 契约、checkpoint 持久化、Prisma schema 增量、API 契约保留边界。本 Sprint **只写 Contract，不实现**。

---

## 1. 评审会状态机（协议 §5.2：状态机必须显式声明）

> 规范集以 9.0 §12.1 锁定的 P1 机器为准。现有 `Review.status` 枚举为 9 值（`draft|diagnosing|ready|running|interrupted|summarizing|completed|failed|archived`，见 `apps/api/src/modules/reviews/reviews.service.ts:9` `REVIEW_STATUS_FLOW`），P1 通过 §7 的 schema delta 将其迁移/折叠到本规范集。

### 1.1 合法 status（P1 规范集，7 个）

| status | 中文语义 | 说明 |
|--------|----------|------|
| `created` | 已创建（待诊断/诊断中） | 覆盖现有 `draft` + `diagnosing` + `ready`：评审创建至诊断+角色确认完成前的阶段 |
| `diagnosed` | 已诊断、角色已确认 | 现有 `ready`（诊断完成 + 角色选定，待 start）折叠于此 |
| `running` | 进行中（某轮 reviewer turns 执行中） | 含 round-1 并行发言与 round-2 辩论；现有 `running` 沿用 |
| `summarized` | 已汇总（Moderator 完成本轮汇总） | 现有 `summarizing` 折叠于此，作为可重复节点 |
| `completed` | 已完成（终态） | 收敛成功 |
| `failed` | 失败（终态） | 执行失败 / 无成功 turn |
| `aborted` | 已中止（终态） | 硬闸强停 / 收敛分不足系统强停 / 人工中止 |

> **补充（向后兼容，非 happy-path）**：现有 `interrupted`（可恢复暂停，HITL 暂停）与 `archived`（终态后归档标志）在 §7 中作为**非规范但保留**的枚举值，`interrupted → running` 恢复；它们不参与 spine 主链路 happy-path，但保证现有 interrupt/resume 与归档能力不丢。

### 1.2 合法流转（含触发条件）

```
created → diagnosed              [diagnose() 完成诊断 + saveRoleSelection() 确认角色]
diagnosed → running(r1)          [startReview()：派发 round-1 并行 reviewer turns]
running(r1) → summarized         [round-1 全部 turn 终态 + Moderator 汇总]
summarized → running(r2)         [可重复：Mock Moderator 判定继续辩论，派发 round-2 debate turns]
summarized → completed           [收敛 / 达 min_rounds 且收敛分达标 / 终止提议通过]
summarized → aborted             [max_rounds 硬闸 / 收敛 override 系统强停]
* → failed                      [执行失败且无成功 turn / 致命错误]
running → interrupted            [HITL 暂停，非规范补充态；interrupt() 现有能力保留]
interrupted → running            [resume() 恢复，非规范补充态]
```

### 1.3 终态

- **终态**：`completed` / `failed` / `aborted`（+ 非规范 `archived` 为生命周期标志）。
- **轮次结构**：round-1（并行 reviewer turns）→ `summarized` → round-2（debate）→ `summarized` → …；轮次上界由 `max_rounds` 硬闸（§5.2）。
- **round-2 触发**：仅在 `summarized` 后、未达 `max_rounds` 且 Mock Moderator 判定"冲突值得深挖"时进入（§10）。

---

## 2. graph runtime 契约（自研 TS，§3.2）

> 对 9.0 §3.2 的接口落地。仅声明类型签名；实现在 9.2（标准 Gate）。P1 仅 mock + logger 注入，`ModelAdapter`/`MemoryService` 标为 P2/P3 注入位。

### 2.1 节点与边

```ts
// 节点：普通 TS 函数，返回 State 的部分更新
export type Node<S extends ReviewState> = (
  state: Readonly<S>,
  ctx: NodeCtx,
) => Promise<Partial<S>>;

// 静态边
export interface StaticEdge {
  readonly kind: 'static';
  readonly from: string;
  readonly to: string;
}

// 条件路由边：从 from 节点出发，按 state 返回下一节点 id
export interface ConditionalEdge {
  readonly kind: 'conditional';
  readonly from: string;
  readonly route: (state: Readonly<ReviewState>) => string;
}

export type Edge = StaticEdge | ConditionalEdge;

// 图定义
export interface Graph<S extends ReviewState> {
  readonly nodes: Record<string, Node<S>>;
  readonly edges: readonly Edge[];
  readonly start: string;
  // 入口节点 id（如 'created'），对应状态机初始态
}
```

### 2.2 ReviewState（强类型）

```ts
export type ReviewStatus =
  | 'created' | 'diagnosed' | 'running'
  | 'summarized' | 'completed' | 'failed' | 'aborted';

export interface TurnRecord {
  readonly turnId: string;
  readonly reviewerId: string;     // = roleVersionId（既有 ReviewTurn.roleVersionId）
  readonly round: number;
  readonly phase: 'round_robin' | 'debate';
  readonly status: TurnStatus;
  readonly opinionRef?: string;    // ReviewOpinion.id
}

export interface ModeratorDecisionRef {
  readonly decisionId: string;
  readonly round: number;
  readonly decisionType: ModeratorDecisionType;
}

// 用量账本（P1 仅 token/round 计数；cost 在 P2 启用）
export interface UsageLedger {
  readonly totalTokens: number;
  readonly totalRounds: number;
  readonly turnsByReviewer: Record<string, number>; // reviewerId -> 发言数
  readonly totalCost: number;  // P1 恒为 0（mock），P2 启用
}

export interface ReviewState {
  readonly reviewId: string;
  status: ReviewStatus;
  round: number;                       // 当前轮次（1-based）
  currentNodeId: string;               // 当前 graph 节点（= 状态机阶段）
  turns: TurnRecord[];
  moderatorDecisions: ModeratorDecisionRef[];
  usage: UsageLedger;
  // 收敛信号（P1 mock 用确定性启发式；P3 起接 rolling summary）
  convergenceScore?: number;
  updatedAt: string;                   // ISO
}
```

### 2.3 Checkpointer 接口

```ts
export interface Checkpoint {
  readonly id: string;
  readonly reviewId: string;
  readonly nodeId: string;             // 转移后的节点（状态）
  readonly stateJson: string;          // ReviewState 序列化
  readonly sequence: number;           // 单调递增，用于取最新
  readonly createdAt: string;
}

export interface Checkpointer {
  save(reviewId: string, nodeId: string, state: ReviewState): Promise<Checkpoint>;
  load(reviewId: string): Promise<{ nodeId: string; state: ReviewState } | null>;
  // 崩了 load 取 sequence 最大者 resume
}
// 后端：Postgres（ReviewCheckpoint 表，见 §6）；Redis 可选作读取缓存层
```

### 2.4 NodeCtx（依赖注入）

```ts
export interface NodeCtx {
  readonly logger: Logger;             // P1 必有
  readonly tracer: Tracer;             // P1 仅 stub；P6 接 OTel
  readonly checkpointer: Checkpointer; // P1 必有（Postgres）
  // 以下为 P2/P3 注入位（P1 不注入，调用方传 null 并由节点判空）
  readonly modelAdapter?: ModelAdapter;       // P2
  readonly memoryService?: MemoryService;     // P3
  readonly promptService?: PromptService;     // P3
  // 既有服务复用（包装，不替换）
  readonly queue: QueueService;        // 既有内存队列（queue.service.ts）
  readonly prisma: PrismaService;      // 既有 ORM
}
```

---

## 3. Turn 契约

### 3.1 输入输出

```ts
export interface TurnInput {
  readonly reviewId: string;
  readonly reviewerId: string;         // roleVersionId
  readonly round: number;
  readonly phase: 'round_robin' | 'debate';
  readonly assembledPrompt: AssembledPrompt; // P3 由 PromptService 组装；P1 由现有 provider-adapter 直接生成
}

export interface TurnOutput {
  readonly turnId: string;
  readonly opinion: StructuredOpinion; // 见 §4
  readonly status: 'completed' | 'failed';
}
```

### 3.2 幂等键

- **幂等键**：`(review_id, reviewer_id, round)` —— 复用既有 `ReviewTurn.roleVersionId` 作为 `reviewer_id`。
- **实现**：`ReviewTurn` 新增唯一列 `idempotencyKey = \`${reviewId}::${roleVersionId}::${round}\``。
- **行为**：重跑命中已有 `completed`/`failed` turn 则 **skip**（泛化现有 `queue.service.ts:executeAgentTurn` 的 `reviewTurn.findFirst({ where: { reviewId, turnIndex, status: in ['completed','failed','timeout'] }})` 幂等检查 + `scripts/run-agent-turns-for-review.js` 的 idempotent skip）。

### 3.3 Turn 生命周期状态

```
created → prompt_assembled → model_invoked → parsed → validated → persisted
                                                        │
                                                        └→ failed（任一阶段失败，写 failed opinion 存根用于可观测）
```

> P1 的 `model_invoked` 走 mock provider（默认），不调真实 LLM；`validated` 执行 §4 校验。

---

## 4. 结构化 opinion schema（版本化 + 校验）

### 4.1 基于现有结构泛化

现有 `ReviewOpinion` 字段（`apps/api/prisma/schema.prisma:194`）：`dimension` / `riskLevel` / `issue` / `recommendation` / `citations`(Json[]) / `confidenceScore`(Int) / `reasoningSummary` / `modelOutputRef` / `feedback`。P1 在原结构上**新增 `schemaVersion`**，并固化校验规则。

```ts
export type RiskLevel = 'high' | 'medium' | 'low' | 'info';

export interface StructuredOpinion {
  readonly schemaVersion: string;      // 新增，如 "1.0"
  readonly reviewerId: string;         // roleVersionId
  readonly round: number;
  readonly dimension: string;          // 非空
  readonly riskLevel: RiskLevel;       // 枚举
  readonly issue: string;              // 非空
  readonly recommendation: string;     // 非空
  readonly citations: readonly string[];
  readonly confidenceScore: number;    // [0,100] 整数
  readonly reasoningSummary?: string;
  readonly modelOutputRef?: string;    // 既有 5 态 providerSource 落库（mock/lmstudio/openai_compatible/fallback_mock/failed）
}
```

### 4.2 校验规则（TS 类型 + 运行校验）

| 字段 | 规则 |
|------|------|
| `schemaVersion` | 必填，语义化版本字符串（正则 `^\d+\.\d+$`） |
| `dimension` | 必填，非空 trim 长度 ≥ 1 |
| `riskLevel` | 必填，枚举 `high\|medium\|low\|info` |
| `issue` | 必填，非空 |
| `recommendation` | 必填，非空 |
| `citations` | 数组，元素为 string（可为空数组） |
| `confidenceScore` | 整数，`0 ≤ x ≤ 100` |
| `modelOutputRef` | 可选；若存，须可 JSON.parse 且含 `providerSource` |

> 校验失败 → turn 标记 `failed` + 写 failed opinion 存根（沿用 `queue.service.ts` 的 guard/fail-closed 模式），不阻塞整场（其他 turn 仍可完成）。

---

## 5. Moderator 契约（P1 mock）

### 5.1 P1 用 mock Moderator

- P1 **不调真实 LLM**：`mockModerator` 按预置规则（轮次计数 + 硬闸）推进，保证默认 mock 红线（9.0 §4.6 / §13）。
- 接口位预留：`Moderator` 接口在 P1 仅由 `MockModerator` 实现；P2/P3 接 `LlmModerator`（真 LLM），仍须显式 env + Gate。

```ts
export type ModeratorDecisionType =
  | 'advance_round'      // 进入下一轮（r1→summarized→r2）
  | 'continue_debate'   // summarized 后继续辩论
  | 'converge'          // 建议 completed
  | 'force_stop'        // 硬闸/收敛 override 强停 → aborted
  | 'terminate_proposal'; // LLM 提终止提议（P1 mock 不触发，留接口）

export interface ModeratorDecision {
  readonly id: string;
  readonly reviewId: string;
  readonly round: number;
  readonly decisionType: ModeratorDecisionType;
  readonly reasoning: string;          // 规则判定依据（P1 确定性）
  readonly ruleCheckResult: RuleCheckResult;
  readonly createdAt: string;          // ISO
}

export interface RuleCheckResult {
  readonly maxRoundsOk: boolean;
  readonly maxTurnsPerReviewerOk: boolean;
  readonly maxTokensOk: boolean;        // P1 恒 true（mock 0 token）
  readonly maxCostOk: boolean;          // P1 恒 true（cost=0）
  readonly convergenceOk: boolean;      // P1 mock 启发式
  readonly passed: boolean;             // 全部 Ok 且未触发强停
}
```

### 5.2 硬闸（代码强制，LLM 不可覆盖）

| 硬闸 | 默认值建议（P1） | 泛化来源 |
|------|------------------|----------|
| `max_rounds` | `3` | 新增；控制辩论轮次上界 |
| `max_tokens_per_review` | `200_000`（仅计数，P1 mock 不触顶） | 新增 |
| `max_cost_per_review` | `0`（P1 禁用，cost 恒 0；P2 启用预算） | 新增 |
| `max_turns_per_reviewer` | `3` | 泛化现有 `MODEL_PILOT_MAX_ROLES=3`（`queue.service.ts:applyPilotRoleCap`） |
| `min_rounds` | `1` | 新增；低于此轮次即使想停也必须继续 |

> 硬闸由 `ReviewOrchestrator` 在每节点转移前强制校验；越界即强停（→ `aborted` 或截断派发）。

### 5.3 收敛 override

- `min_rounds` 后，若收敛分低于阈值（P1 mock 用确定性启发式：如所有 reviewer 已发言且无非决议冲突，或 `round >= max_rounds`）→ 系统可强停。
- P1 mock 下**规则层直接判定**（无 LLM 反对路径）；`LlmModerator` 的"反对须过 sanity check"在 P2/P3 实现，接口位已留（`terminate_proposal` + `ruleCheckResult`）。

### 5.4 决策审计

- 每条 `ModeratorDecision` 落 `ModeratorDecision` 表（§7）；与 §2.2 `moderatorDecisions` 引用联动。
- 审计表是 v1 shadow 模式与可观测性的锚点（9.0 §4.4/§4.5）。

---

## 6. Checkpoint 持久化 schema（Postgres）

```prisma
model ReviewCheckpoint {
  id         String   @id @default(uuid()) @db.Uuid
  reviewId   String   @map("review_id") @db.Uuid
  nodeId     String   @map("node_id")          // 转移后的 graph 节点（= 状态）
  stateJson  String   @map("state_json")        // ReviewState 序列化（JSON 文本）
  sequence   Int                               // 单调递增，resume 取最大
  createdAt  DateTime @default(now()) @map("created_at")

  review Review @relation(fields: [reviewId], references: [id])

  @@unique([reviewId, sequence])
  @@index([reviewId])
  @@map("review_checkpoints")
}
```

- 每节点转移后 `checkpointer.save(reviewId, nodeId, state)`。
- 崩溃后 `load(reviewId)` 取 `sequence` 最大者 → `ReviewState` → 从 `currentNodeId` resume。

---

## 7. Prisma schema 增量（delta 清单，**不实施**）

> 基于现有 `apps/api/prisma/schema.prisma`。仅**声明** delta；**实施**在 9.2 实现 Sprint，走**标准 Gate**（动 schema，协议 §5.4）。本 Contract 不写迁移。

### 7.1 决策点：ReviewerTurn 新表 vs 既有 ReviewTurn 加字段

**决策：在既有 `ReviewTurn` 表加字段，不新建 `ReviewerTurn` 表。**

| 取舍维度 | 加字段到 `ReviewTurn`（✅ 选） | 新建 `ReviewerTurn`（✗ 舍） |
|----------|------------------------------|----------------------------|
| 关系图 | 复用既有 `reviewTurn.opinions` 关系，report/queue 代码零改 | 需复制 `ReviewOpinion.turnId` 外键，破坏 `reviews.service.ts`/`queue.service.ts` 读取路径 |
| 幂等 | `idempotencyKey` 加在既有表，沿用 `reviewTurn.findFirst` 逻辑 | 新表需重写幂等查询 |
| 兼容 | `turnIndex`/`phase`/`roleVersionId`/`status` 全部保留 | 重复定义，迁移成本高 |
| 风险 | 低（增量列，nullable/有默认） | 高（关系重建 + 双写过渡） |

### 7.2 `ReviewTurn` 新增字段

```prisma
model ReviewTurn {
  // …既有字段保留（id, reviewId, turnIndex, phase, roleVersionId, status, startedAt, completedAt, createdAt）
  round           Int    @default(1) @map("round")      // P1 新增：轮次（1-based）
  idempotencyKey  String @unique @map("idempotency_key") // P1 新增：${reviewId}::${roleVersionId}::${round}
  schemaVersion   String @default("1.0") @map("schema_version") // P1 新增：opinion schema 版本（与 ReviewOpinion 对齐）
  // phase 既有 'round_robin' 保留；round-2 用 'debate' 标记
}
```

### 7.3 `ReviewOpinion` 新增字段

```prisma
model ReviewOpinion {
  // …既有字段保留（dimension, riskLevel, issue, recommendation, citations, confidenceScore, reasoningSummary, modelOutputRef, feedback）
  schemaVersion String @default("1.0") @map("schema_version") // P1 新增；与 §4 对齐
  round         Int?   @map("round")  // 可选冗余列，便于报告按轮聚合（主来源为 ReviewTurn.round）
}
```

### 7.4 `Review` 表新增字段（checkpoint/resume 支撑）

```prisma
model Review {
  // …既有字段保留
  currentRound  Int    @default(1) @map("current_round")   // P1 新增：当前轮次
  currentNodeId String? @map("current_node_id")            // P1 新增：当前 graph 节点（resume 锚点）
}
```

### 7.5 新增表

- `ReviewCheckpoint`（§6 完整定义）。
- `ModeratorDecision`（审计，§5.1 接口）：

```prisma
model ModeratorDecision {
  id             String   @id @default(uuid()) @db.Uuid
  reviewId       String   @map("review_id") @db.Uuid
  round          Int      @map("round")
  decisionType   String   @map("decision_type") // advance_round|continue_debate|converge|force_stop|terminate_proposal
  reasoning      String
  ruleCheckResult Json   @map("rule_check_result") // RuleCheckResult 序列化
  createdAt      DateTime @default(now()) @map("created_at")

  review Review @relation(fields: [reviewId], references: [id])
  @@index([reviewId, round])
  @@map("moderator_decisions")
}
```

### 7.6 `Review.status` 枚举迁移（关键 delta）

| 现有枚举值（9.0 前） | P1 规范映射 |
|----------------------|-------------|
| `draft` | → `created` |
| `diagnosing` | → `created`（诊断中，折叠进 created 阶段） |
| `ready` | → `diagnosed`（诊断+角色确认完成） |
| `running` | → `running`（沿用） |
| `summarizing` | → `summarized` |
| `completed` / `failed` | → 沿用 |
| `interrupted` | 保留为**非规范补充态**（HITL 暂停，`interrupted → running` 恢复） |
| `archived` | 保留为**生命周期标志**（终态后归档，非 spine 主链路） |

> 实施（9.2）须写数据迁移：existing rows 按上表 update status；`REVIEW_STATUS_FLOW`（`reviews.service.ts:9`）重写为 P1 规范流转（§1.2）。

---

## 8. API 契约保留边界（红线）

- **保持不变的对外接口**（来自 `scripts/setup-demo-review.js` + `MVP_Demo_Runbook.md`）：
  - `POST /api/reviews`（创建）
  - `POST /api/reviews/{id}/diagnose` + `GET /api/reviews/{id}/diagnosis`
  - `POST /api/reviews/{id}/roles` + `POST /api/reviews/{id}/start`
  - `GET /api/reviews/{id}/meeting/stream`（SSE，从 DB 读 turns/opinions，沿用 `validateMeetingStream`）
  - `GET /api/reviews/{id}/report` + `GET /api/reviews/{id}/report/export.md`
- **P1 是后端内部重构，前端零改动**：上述端点行为（含 `source=mock_fallback`/`db_opinions`、`providerSummary` 五态、Markdown 导出）全部保持。
- **仅新增内部接口**：graph runtime / checkpointer 为内部模块调用，不新增对外 REST/SSE 端点。
- **回归保护**：`setup-demo-review.js`（路线 A/B）、Report API、SSE 在 9.2 实现后必须不破（§12 验证期望）。

---

## 9. 模块边界

### 9.1 `ReviewOrchestrator`（新，P1 核心）

- 新模块，承载 **graph 脊柱 + Moderator 逻辑**。
- **包装**既有 runner/queue（`apps/api/src/modules/reviews/queue/queue.service.ts` + `scripts/run-agent-turns-for-review.js`），**不是替换**：
  - 既有 `QueueService.enqueue('review.start' | 'agent.turn.execute' | 'meeting.complete')` 继续作为 turn 执行载体。
  - `ReviewOrchestrator` 在节点转移时调用 `QueueService` 派发 turn，并以 `Checkpointer` 落状态；`executeAgentTurn` 的 DB 幂等 + `applyPilotRoleCap` 泛化为 `max_turns_per_reviewer`/`max_rounds` 硬闸。
  - `getReport`/`buildProviderSummary`/`exportMarkdown`（`reviews.service.ts`）继续作为 `ReportingService` 雏形，P1 不改其行为。

### 9.2 `AgentRuntime` worker 抽取 = P6（P1 不做）

- 9.0 §5 明确：唯一现在就抽独立进程的是 `AgentRuntime` worker。但 **P1 不抽进程**——turn 执行仍在现有 runner/queue 进程内（内存队列），仅**结构化上脊柱**（状态机/checkpoint/幂等/硬闸）。
- 显式声明：**P1 不做进程抽取**；`AgentRuntime` 独立 worker + 多实例在 P6 落地（OTel 全链路协同）。

---

## 10. round-2 mock debater（§12.3）

- P1 round-2 "辩论"用 **mock debater**：debate turns 由 mock 生成（确定性、不依赖真实模型），验证 graph 脊柱的 `running(r2) → summarized` 分支 + `max_rounds` 硬闸兜底。
- 触发：round-1 `summarized` 后，Mock Moderator 用确定性启发式（如存在 riskLevel=high 的冲突意见）→ `continue_debate` → 派发 round-2 `phase='debate'` turns（选冲突双方 reviewer）。
- 安全：默认 mock 下零真实模型依赖；`max_rounds` 硬闸保证不会无限辩论。
- 真实辩论质量在 P2/P3 模型层就绪后自然提升，无需改脊柱。

---

## 11. 技术边界（In / Out）

### In（P1）
状态机显式化、graph runtime（TS 自研）、turn 幂等、结构化 opinion schema、mock Moderator + 决策审计、checkpoint/resume、round-2 mock debater、API 契约保留、前端零改动、（schema delta 声明，实施归 9.2）。

### Out（后续 phase）
- Model Adapter 泛化（P2）、Prompt/Memory/RAG（P3）、Tool/HITL（P4）、Workflow/评分（P5）、`AgentRuntime` worker 抽取 + OTel（P6）。

### P1 红线
- 默认 mock（含 Moderator）。
- 真模型仅显式 env + Gate。
- **schema 变更（§7）实施走标准 Gate**（非 fast-gate）：动 Prisma schema + 状态机实现，触发协议 §5.2/§5.4 + §7.1 退回标准流程。
- 不 `--force`。

---

## 12. 验证期望（供 9.2 实现遵守）

| 验证项 | 期望 |
|--------|------|
| `tsc --noEmit` | 0 errors（apps/api，managed node 22.22.2） |
| smoke：全链路 | 默认 mock 下 round-1 + round-2 mock debater + summarize + completed 跑通 |
| 回归 | `setup-demo-review.js`（路线 A/B）、Report API、SSE 不破 |
| 幂等 | 对已完成 turn 重跑命中 skip（idempotencyKey 唯一约束 + findFirst） |
| 硬闸 | `max_rounds=3` 时第 4 轮不派发；`max_turns_per_reviewer` 超限不再派发 |
| checkpoint | 中途置 review 为 `running` + 写入 `ReviewCheckpoint`，重启后 `load` 从 `currentNodeId` resume |
| 审计 | 每条 Moderator 决策落 `ModeratorDecision`，`ruleCheckResult.passed` 可查 |

---

## 13. Gate 模式声明

### 13.1 本 Contract Sprint（9.1）= 纯文档，fast-gate

依据协议 §7.1：

| §7.1 条件 | 本 Sprint 9.1 | 结论 |
|-----------|---------------|------|
| 1. 不改 Prisma schema | ✅ 仅声明 delta（§7），未实施 | 满足 |
| 2. 不改状态机实现 | ✅ 仅声明目标状态机（§1），未改代码 | 满足 |
| 3. 不涉及真实 LLM/Embedding/MinIO 首次接入 | ✅ 无模型调用 | 满足 |
| 4. 不改前端主页面 | ✅ 前端零改动 | 满足 |
| 5. 不引入新外部依赖 | ✅ 无依赖变更 | 满足 |

**结论**：9.1 为**纯文档**，符合快速 Gate 模式。

### 13.2 本 Contract 指定的 9.2 实现 Sprint = 标准 Gate（必须显式声明）

> ⚠️ **9.2 实现 Sprint 不得走 fast-gate**。本 Contract 的 §7（Prisma schema 增量）+ §1（状态机实施）将**实际改动 schema 与状态机实现**，触发协议 §5.2（状态机）/ §5.4（schema）+ §7.1 退回标准流程。9.2 须走**标准 Gate**（§2 全文档 + qoderwork 审查 + tsc/smoke 证据），由 Codex 裁决 Go/No-Go。

---

## 附：交付物清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `docs/coordination/Sprint_9.1_Orchestrator_Spine_Contract.md` | 新增（本文件） | P1 编排脊柱 Backend Contract（13 节） |
| `docs/coordination/ACTIVE_SPRINT.md` | 更新 | 滚动到 9.1；9.0 推进为 Go（bbed578），新增 9.1 In Progress |

> 本 Sprint 未执行 `git commit` / `git push`。文档就绪后回报 Codex，由 Codex 走 fast-gate（workbuddy-review）再决定是否提交。
