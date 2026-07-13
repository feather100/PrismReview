# Sprint 9.4 — P1 编排脊柱（single-round）后端实现记录

> 标准 Gate（非 fast-gate）。Owner: `workbuddy-coder`。基线：`c7158ab`（9.3 Go）。
> 本文档为 9.4 实现证据，配套 `ACTIVE_SPRINT.md`（已滚动到 9.4）。未执行 `git commit` / `push`。

---

## 1. 目标与定位

在 **9.1 Contract**（§2–§6 类型 / §7 schema delta / §9.1 包装语义）+ **9.2**（加性 schema 已就位：`ReviewCheckpoint` / `ModeratorDecision` / `ReviewTurn.round` / `idempotencyKey` / `Review.currentRound` / `currentNodeId`）+ **9.3**（枚举物理重命名就位）之上，实做 **P1 编排脊柱（single-round）**：

- 自研最小 graph runtime（LangGraph 范式、零 `@langchain/langgraph` 依赖，符合 9.0 决策 1）
- `ReviewOrchestrator` **包装**既有 `QueueService`（不替换）
- round-1 派发 + mock Moderator（仅 `converge`） + checkpoint/resume + opinion 校验 + turn 幂等

**明确在范围外（9.5）**：round-2 debate / `continue_debate` / 多轮循环 / `max_rounds` 全演练 / 真 LLM / `ModelAdapter`(P2) / `Memory`·`Prompt`(P3) / `Tool`·`HITL`(P4)。本次未触碰上述任何一项；硬闸检查代码存在但单轮不触顶。

---

## 2. 范围 In / Out

### In（已实现）
| 能力 | 落点 |
|---|---|
| graph runtime 类型（§2：`Node`/`StaticEdge`/`ConditionalEdge`/`Graph`/`ReviewState`/`TurnRecord`/`ModeratorDecisionRef`/`UsageLedger`/`Checkpoint`/`Checkpointer`/`NodeCtx`） | `orchestrator/graph-runtime.ts` |
| opinion schema 校验（§4：`StructuredOpinion` + §4.2 运行校验） | `orchestrator/opinion.ts` |
| mock Moderator + 硬闸（§5：`RuleCheckResult`/`HardGates`/`DEFAULT_HARD_GATES`/`Moderator`/`MockModerator`，converge-only + 审计落库） | `orchestrator/moderator.ts` |
| turn 幂等（§3：语义元组查询，覆盖 3/4 段键） | `orchestrator/idempotency.ts` |
| 每评审员硬闸（§5.2：`max_turns_per_reviewer` 泛化自 `MODEL_PILOT_MAX_ROLES`） | `orchestrator/hard-gates.ts` |
| Postgres Checkpointer（§6：sequence 单调，load 取最新 = resume 锚点） | `orchestrator/postgres-checkpointer.ts` |
| ReviewOrchestrator 脊柱（created→diagnosed→running(r1)→summarized(Moderator converge)→completed，每节点 checkpoint） | `orchestrator/review-orchestrator.ts` |
| QueueService 接线（completionHook 注入，turn 全终态 → 脊柱收口） | `queue/queue.service.ts` |
| QueueService `applyPilotRoleCap` 语义泛化为 `max_turns_per_reviewer` | `queue/queue.service.ts` + `orchestrator/hard-gates.ts` |

### Out（9.5，未实现、未越界）
round-2 / `continue_debate` / 多轮循环 / `max_rounds` 全演练 / 真 LLM / `ModelAdapter`(P2) / `Memory`·`Prompt`(P3) / `Tool`·`HITL`(P4)。`ReviewOrchestrator` 仅 `converge`，`ModeratorDecisionType` 其余枚举保留为类型但未在 P1 产出。

---

## 3. 代码改动清单

### 新增 `apps/api/src/modules/reviews/orchestrator/`
- `graph-runtime.ts` — Contract §2 全部类型；`ReviewStatus`/`TurnStatus`/`TurnPhase`/`TurnRecord`/`ModeratorDecisionType`/`ModeratorDecisionRef`/`UsageLedger`/`ReviewState`/`Checkpoint`/`Checkpointer`/`Node`/`StaticEdge`/`ConditionalEdge`/`Edge`/`Graph`/`NodeCtx`（P2/P3 注入位传 `undefined`）；`TERMINAL_STATUSES` + `isTerminalStatus`。
- `opinion.ts` — `RiskLevel`/`StructuredOpinion`/`OpinionValidationResult` + `validateOpinion()`（§4.2：schemaVersion `^\d+\.\d+$` / dimension·issue·recommendation 非空 / riskLevel 枚举 / confidenceScore 整数 [0,100] / modelOutputRef 可 JSON.parse 含 `providerSource`）。
- `moderator.ts` — `RuleCheckResult`/`ModeratorDecision`/`HardGates`/`DEFAULT_HARD_GATES`(maxRounds=3/maxTurnsPerReviewer=3/minRounds=1/maxTokens=200000/maxCost=0) / `Moderator` 接口 + `MockModerator`（`@Injectable`，`decide()` 跑硬闸 + 单轮 converge-only，落库 `moderatorDecision` 含 `ruleCheckResult`）+ `toDecisionRef()`。
- `idempotency.ts` — `findExistingTerminalTurn(prisma, {reviewId, roleVersionId, round})`：**按语义元组**查询（status ∈ completed/failed/timeout），覆盖 3 段与 4 段 idempotencyKey，**不依赖 idempotencyKey 字符串相等**（Codex 指令 1）。
- `hard-gates.ts` — `resolveHardGates()`（从 `MODEL_PILOT_MAX_ROLES` 解析 `maxTurnsPerReviewer`，默认 3）+ `shouldDispatchTurn(prisma, {reviewId, roleVersionId, maxTurns})`（count < maxTurns 才可派发）。
- `postgres-checkpointer.ts` — `PostgresCheckpointer`（`@Injectable`）：`save` 用 aggregate max(sequence)+1；`load` 取 `findFirst orderBy sequence desc` 解析 `ReviewState`。
- `review-orchestrator.ts` — `ReviewOrchestrator`（`@Injectable`，`onModuleInit` 接线 `queue.completionHook`）；`buildGraph()`（7 节点 + 静态/条件边）；`start()`（校验 status=running → 派发 round-1 → checkpoint/persist）；`nodeRunning`（硬闸检查 + `queue.enqueue('review.start')`）；`handleTurnsComplete`（Moderator decide → summarized → converge→completed 或 force_stop→aborted）；`resume()`（从 checkpoint.currentNodeId 恢复）；`buildState`/`persistState`。
- `index.ts` — barrel 导出。

### 编辑既有文件
- `queue/queue.service.ts`
  - import `findExistingTerminalTurn`/`shouldDispatchTurn`/`resolveHardGates`/`validateOpinion`/`StructuredOpinion`/`RiskLevel`；
  - 新增 `completionHook?` 字段；
  - `executeReviewStart` 循环内加 `shouldDispatchTurn` 每评审员硬闸（达上限 `continue` 跳过）；
  - `executeAgentTurn` 幂等查询改用 `findExistingTerminalTurn({reviewId, roleVersionId, round: payload.round ?? 1})`（覆盖 3/4 段）；
  - `executeAgentTurn` 写 opinion 前加 `validateOpinion` 校验，失败 → turn failed + 失败存根 + throw `NO_RETRY`；
  - `executeMeetingComplete` 全终态后若 `completionHook` 存在则委派（走脊柱），否则 legacy 定终态。
- `reviews.service.ts` — import `ReviewOrchestrator`；constructor 注入；`startReview` 改为 `await this.orchestrator.start(reviewId)`（去掉直接 `queueService.enqueue('review.start')`）。
- `reviews.module.ts` — providers 加 `ReviewOrchestrator`/`PostgresCheckpointer`/`MockModerator`；exports 加 `ReviewOrchestrator`。

### 新增验证脚本
- `apps/api/scripts/verify-9.4-spine.js` — 对**真实 Prisma + 真实 QueueService/ReviewOrchestrator 实例**断言 12/12（见 §6）。

---

## 4. Codex 5 条指令落实对照

| # | 指令 | 落实 |
|---|---|---|
| ① | 幂等查询覆盖 3 段 + 4 段 idempotencyKey（P2-1，CRITICAL） | `idempotency.ts` 按语义元组 `(reviewId, roleVersionId, round)` 查询，不依赖字符串相等 → 天然覆盖 3 段 `${rid}::${rvid}::${round}` 与 4 段 `${rid}::${rvid}::${round}::${N}`。验证脚本 (a.1/a.2/a.3) 三例全过：3+4 段同元组均命中；round=2 不被 round=1 查询命中；不同 reviewer 不命中。 |
| ② | 9.4 = single-round（无 round-2/continue_debate/多轮；max_rounds 检查存在但单轮不触顶） | `review-orchestrator.ts` 仅 `converge` 收口；`nodeRunning` 含 `state.round > gates.maxRounds` 硬闸检查（单轮 round=1 远未触顶）；无 `advance_round`/`continue_debate` 产出路径。 |
| ③ | ReviewOrchestrator 包装 QueueService 不替换 | `onModuleInit` 仅注入 `queue.completionHook`；turn 执行仍走 `QueueService.enqueue('review.start')` → `executeAgentTurn`（既有 DB 幂等 + 每评审员硬闸）。零重写既有调度链路。 |
| ④ | API 契约保留 + 前端零改动 | 未碰任何 `.tsx`/前端；`reviews.service.startReview` 签名不变；SSE 网关轮询 DB turns（与 `Review.status` 解耦），脊柱改 status 不破坏 SSE。 |
| ⑤ | 默认 mock（max_cost_per_review=0） | `DEFAULT_HARD_GATES.maxCostPerReview=0`；`MockModerator` 不调 LLM；`provider-adapter` 默认 `MODEL_PROVIDER` unset/mock → mock provider，零外部调用。 |

---

## 5. 关键设计决策

1. **包装而非替换**：符合 9.1 §9.1 与 9.0 决策（P1 不做进程抽取，QueueService 保持进程内）。completionHook 注入而非独立 worker。
2. **语义元组幂等（P0 防呆）**：旧写法 `idempotencyKey === '...::1'` 只会匹配 3 段键，漏 4 段键 → 幂等失效。改为按 `(reviewId, roleVersionId, round)` 查 `ReviewTurn`，与键格式解耦，3/4 段一律覆盖。
3. **硬闸两语义区分**：`applyPilotRoleCap`（角色列表长度裁剪，仅 lmstudio pilot 模式）≠ `max_turns_per_reviewer`（单评审员最大发言数，新门控 `shouldDispatchTurn`）。9.4 新增后者，前者行为不变（默认 mock 不受 pilot cap 影响）。
4. **checkpoint/resume 锚点**：`ReviewCheckpoint.sequence` 单调，`load` 取最大 → `currentNodeId` resume。`resume()` 对 `running` 重派发（幂等 skip 已终态）+ 补 `handleTurnsComplete`；对 `summarized` 直接补 `handleTurnsComplete`。
5. **SSE 解耦**：`reviews.gateway.ts` 轮询 DB turns，不依赖 `Review.status`；脊柱改 status 不破坏前端实时性。
6. **审计落库**：每条 Moderator 决策写 `ModeratorDecision`（含 `ruleCheckResult` JSON），`passed=true` 可查，满足 §5.4 审计要求。

---

## 6. 验证证据

### 6.1 类型检查（0 errors）
- `tsc -p apps/api/tsconfig.json --noEmit` → exit 0
- `tsc -p apps/web/tsconfig.json --noEmit` → exit 0

### 6.2 迁移（up to date）
- `prisma migrate deploy` → `3 migrations found` / `No pending migrations to apply.` exit 0
- Docker Postgres 16-alpine 健康（verify 脚本实时连接成功，证明 DB 可达）

### 6.3 定向验证 `apps/api/scripts/verify-9.4-spine.js`（真实实例 12/12）

```
[PASS] (a.1) idempotency covers 3-seg & 4-seg keys — found=true
[PASS] (a.2) idempotency filters by round (round=2 not matched by round=1) — found=false
[PASS] (a.3) idempotency scoped by roleVersionId — found=false
[PASS] (b.1) hard gate blocks 4th dispatch when 3 already exist — canDispatch=false
[PASS] (b.2) hard gate allows dispatch below limit — canDispatch=true
[PASS] (c) checkpointer.load returns latest sequence (resume anchor) — nodeId=summarized
[PASS] (d.1) MockModerator single-round → converge — decisionType=converge
[PASS] (d.2) ModeratorDecision audit persisted with ruleCheckResult.passed=true
[PASS] (e.1) full spine reaches completed via orchestrator — status=completed, turns=2
[PASS] (e.2) per-node checkpoints written (running→summarized→completed) — [running,summarized,completed]
[PASS] (e.3) converge decision present with passed=true on spine
[PASS] (f) resume from summarized checkpoint → completed (converge) — status=completed, conv=present
=== 9.4 spine verify: 12/12 passed ===
```

全链路脊柱关键日志（e）：
```
ReviewOrchestrator wired to QueueService.completionHook
Enqueued: review.start … → Enqueued: agent.turn.execute ×2
Turn 1/CTO: high risk, 78 confidence / Turn 2/CFO: medium risk, 72 confidence
All 2 turns terminal → delegating to orchestrator.handleTurnsComplete
Moderator decision: … type=converge passed=true
Checkpoint saved: node=running seq=1 / node=summarized seq=2 / node=completed seq=3
Spine complete: … → completed (single-round)
```

### 6.4 密钥扫描（净）
- `git grep -nE 'sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]{20,}' -- apps/ scripts/ docs/`
- 仅命中 `docs/coordination/` 历史文档脱敏占位符 `sk-xxxxxxxxxxxxxxxx`（非真实 Key、非本次文件，9.3 已记录）。
- 对本次新增/修改源码（`apps/api/src/modules/reviews/orchestrator/`、`queue.service.ts`、`reviews.service.ts`、`reviews.module.ts`、`apps/api/scripts/verify-9.4-spine.js`）单独 Grep **零命中**。

---

## 7. 红线核对表

| 红线 | 状态 |
|---|---|
| 标准 Gate（非 fast-gate） | ✓ 走标准 Gate |
| 默认 mock（不调真实 LLM） | ✓ `max_cost_per_review=0`、provider 默认 mock |
| 不写密钥 | ✓ 无真实 Key；`Authorization` 头不打印；`MODEL_API_KEY` 不落库 |
| 不提交 `.env`/`node_modules`/`data`/`.reasonix`/`.workbuddy`/日志 | ✓ 均未纳入变更 |
| 不 `--force` / 不伪造验证证据 | ✓ 所有证据为真实实跑（verify 12/12 为真实 Prisma 实例） |
| 未执行 `git commit` / `push` | ✓ 仅回报 Codex 待复审 |
| 前端零改动 | ✓ 未碰 `.tsx` |
| 不越界 9.5 | ✓ 未实现 round-2/多轮/真 LLM/P2-P4 |
| 不改 schema | ✓ 复用 9.2 加性列，零迁移 |

---

## 8. Gate 声明

- **Gate 类型**：标准 Gate（协议 §5）。
- **证据状态**：代码 + 类型检查 + 迁移 + 真实实例定向验证（12/12）+ 密钥扫描 全部就绪。
- **提交状态**：**未提交**。待 Codex 交 `workbuddy-review` 走标准 Gate 复审后，由 Codex 决定是否 `git commit` / `push`。
- **基线**：`c7158ab`（9.3 Go）之上；本次改动为加性（新增 `orchestrator/` 模块 + 3 文件小改 + 验证脚本）。
