# ACTIVE SPRINT

> 单一入口：所有 agent 开工前必须先读本文件，确认当前 Sprint 状态、输入/输出文档、负责人与 Gate 状态。
> 本文件随 Sprint 滚动更新，不归档。

---

## 当前状态

- **Current Sprint**: Sprint 2.2
- **Phase**: P2 真 LLM Moderator 接线 + LM Studio Adapter 实测（Sprint 2.1 Model Adapter 抽象层已就位，本 Sprint 把LM Studio provider 走通）
- **Status**: In Progress（代码 + 文档就绪，待入库）
- **Last Updated**: 2026-07-14
- **Owner**: Codex 协调（workbuddy-coder + workbuddy-docs 已交付）

---

## P1 已完整收官

Sprint 9.0 ~ 9.5b（commit `05c9bbf`）完整落地 P1 编排脊柱：状态机 + graph runtime + mock Moderator + checkpoint + round-1/2/多轮/max_rounds 兜底。

---

## 当前目标

在 9.4（P1 编排脊柱 single-round，commit `7a8b4e6`）+ 9.5a（P1 多轮地基，修 P2-1~P2-4，未提交）+ 9.1 Contract + 9.2（schema）+ 9.3（枚举）基础上，实做 **P1 收官：多轮回合（round-2 + 多轮循环 + max_rounds 兜底）**（workbuddy-coder 实现，标准 Gate），闭合 9.5a review §8 三条须知悉项：

- **① `continue_debate → running(r2)` 已实现**：`routeAfterSummarized` 的 `advance_round`/`continue_debate` 均返 `running`；`handleTurnsComplete` 新增 `next==='running'` 分支 → `currentRound++` + 派发 round-N（9.5a 留空的 `summarized` 空分支已闭合）。
- **② `max_rounds` 每轮重校验双闸**：`Moderator.decide()` 在 `round >= maxRounds` 返 `force_stop`；`handleTurnsComplete` 派发前防御性 `if (nextRound > maxRounds) → force_stop→aborted`；起点闸（9.4/9.5a 既有）保留。满足 Contract §5.3"每转移前校验"。
- **③ `advance_round` 也派发 round-2**：`advance_round` 与 `continue_debate` 统一路由到 `running` 节点，均触发 `currentRound++` + round-N 派发（9.5a 使 review 永久停留 `summarized` 的问题已修复）。
- **round-2 mock debater**：`Moderator` 新增冲突检测启发式（本轮 ≥2 条 high-risk opinion → `continue_debate`）+ `detectConflict(reviewId, round)` 私有方法；`queue.service.ts` 派发 `phase: round>=2?'debate':'round_robin'`，`agent.turn.execute` jobId 带 `r${round}`；确定性、不依赖真实模型、`max_cost_per_review=0`。
- **round-scoped 幂等与派发**：`checkMeetingComplete`/`executeMeetingComplete` 按 `review.currentRound` 过滤 terminal count、jobId 带 `.r${currentRound}`，杜绝 round 串扰与 round-2 误拦截（9.5a 单轮下不可见的多轮 correctness 关键）。
- **多轮循环**：`[running→summarized]*→(completed|aborted)` 闭环，`summarized` 条件边读 `state.lastDecisionType` 驱动下一次路由。

- 复用 9.4/9.5a 既有 `apps/api/src/modules/reviews/orchestrator/` 模块（graph-runtime / opinion / moderator / idempotency / hard-gates / postgres-checkpointer / review-orchestrator / index），本 sprint 仅改 `moderator.ts` / `review-orchestrator.ts` / `queue.service.ts` 三文件：
- `ReviewOrchestrator` **包装**既有 `QueueService`（不替换）：经 `queue.completionHook` 注入回调，turn 全部终态后触发 `handleTurnsComplete` → mock Moderator `converge` → `completed`；每节点 `checkpointer.save`；
- round-1 派发走 `QueueService.enqueue('review.start')`（既有 `executeReviewStart`/`executeAgentTurn` 内部含 DB 幂等 + 每评审员硬闸，零重写）；
- mock Moderator（converge / continue_debate 冲突启发式 / advance_round / force_stop 四类决策）+ 硬闸（maxRounds=3 / maxTurnsPerReviewer=3 / minRounds=1 / maxTokens=200000 / maxCost=0）+ 每条决策落 `ModeratorDecision` 审计；
- turn 幂等按**语义元组** `(reviewId, roleVersionId, round)` 查询（Codex 指令 1，CRITICAL），天然覆盖 3 段 `${rid}::${rvid}::${round}` 与 4 段 `${rid}::${rvid}::${round}::${N}` 键，不依赖 idempotencyKey 字符串相等；
- opinion schema 运行校验（§4.2：schemaVersion 正则 / dimension / riskLevel 枚举 / issue / recommendation / citations / confidenceScore[0,100] 整数 / modelOutputRef 可 JSON.parse），失败 → turn failed + 失败存根；
- checkpoint/resume：Postgres `ReviewCheckpoint`（sequence 单调，load 取最大 = resume 锚点）；
- `queue.service.ts` 泛化 `applyPilotRoleCap` 语义为 `max_turns_per_reviewer`（硬闸 `shouldDispatchTurn`），与 §5.2 对齐；
- 前端零改动（API 契约保留）；默认 mock（max_cost_per_review=0，不调真实 LLM）；
- 验证：`apps/api/scripts/verify-9.5b-multiround.js` 对真实 Prisma + 真实 QueueService/ReviewOrchestrator/MockModerator 实例断言 **22/22**（S0 单轮回归 4 + S1 三轮回合到顶 aborted/currentRound=3/决策序列 continue_debate×2+force_stop/turn round 1,2,3/debate phase/第4轮不派发/per-node checkpoint/审计 passed/幂等 3 段+4 段键 + P2-1 一致性 + S2 2 轮回合 + S3 advance_round 派发 round-2）；standing `scripts/smoke-runtime.js` **31/31** 回归；tsc(api+web) 0 errors；Docker Postgres healthy；migrate deploy up to date（零迁移）；密钥扫描干净（仅历史 docs 脱敏占位符，本次代码零命中）；
- 产出 `docs/coordination/Sprint_9.5b_MultiRound_Debate_Backend.md`（实现记录，新增）+ 本文件滚动到 9.5b。**未执行 git commit / push**（标准 Gate 红线，待复审）。

> 9.3 已 Go（commit `c7158ab`）：枚举物理重命名 + 前后端 6 处引用 + idempotencyKey 语义键回填修正，为 9.4 的 graph 脊柱铺好 `Review.status` 文本列与枚举集。9.5（round-2 debate / 多轮 / ModelAdapter(P2) 等）明确在范围外，本次未触碰。
- 新增 `ReviewCheckpoint` / `ModeratorDecision` 两表；`ReviewTurn` / `ReviewOpinion` / `Review` 仅加列（`round` / `idempotencyKey` / `schemaVersion` / `currentRound` / `currentNodeId` + 反向关系）；
- 生成并实跑 Prisma 迁移 `20260713121800_add_orchestrator_spine_schema`，回填历史 324 行 `review_turns`（NOT NULL + UNIQUE 约束可被满足）；
- 修复 2 个 `reviewTurn.create` 写入点（含任务原假设遗漏的 standalone runner 脚本），使加性约束下系统不破；
- tsc 0 errors；Docker 全栈实跑；seed + 3 路冒烟（runtime / route A / route B）全绿；密钥扫描干净；
- 产出 `docs/coordination/Sprint_9.2_Schema_Migration_Backend.md`（证据）；**未执行 git commit / push**（标准 Gate 红线，待复审）。
引用 9.1 Contract（`10cec39` 基线之上）+ 现有代码 `apps/api/prisma/schema.prisma`、`queue.service.ts`、`scripts/run-agent-turns-for-review.js`。**不触碰 `REVIEW_STATUS_FLOW`、不改枚举、不实现 graph runtime / Moderator / round-2（均属 9.3）。**
- 新增 `docs/coordination/Sprint_9.1_Orchestrator_Spine_Contract.md`（主文档：状态机 / graph runtime 接口 / turn schema / Moderator 契约 / checkpoint schema / Prisma delta / API 契约保留 / 模块边界 / round-2 mock debater / 技术边界 / 验证期望 / Gate 声明，共 13 节）；
- 滚动本文件到 9.1，并将 9.0 行从 In Progress 推进为 **Go**（commit `bbed578`，已推送），新增 9.1 In Progress 行。
引用 9.0 已 Go 的架构权威（`bbed578`）+ 现有代码 `apps/api/prisma/schema.prisma`、`reviews.service.ts`、`queue.service.ts`、`scripts/run-agent-turns-for-review.js`、`scripts/setup-demo-review.js`。**不改业务代码、不运行模型、不写密钥、未执行 git commit。**

---

## 当前输入文档

- `docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md`（架构权威，9.0 Go，`bbed578`）
- `docs/coordination/ACTIVE_SPRINT.md`（上一跳 9.0，本次滚动到 9.1）
- `docs/coordination/AGENT_COORDINATION_PROTOCOL.md`（§2 标准流程 / §4 命名 / §5 红线 / §6 Gate / §7 快速 Gate）
- `apps/api/prisma/schema.prisma`（现有 Review / ReviewTurn / ReviewOpinion 模型 — Contract 的 schema delta 基于此）
- `apps/api/src/modules/reviews/reviews.service.ts`（现有 `REVIEW_STATUS_FLOW`、diagnose/start/summarize/getReport/exportMarkdown）
- `apps/api/src/modules/reviews/queue/queue.service.ts`（现有 QueueService：review.start → agent.turn.execute → meeting.complete、idempotent skip、applyPilotRoleCap）
- `scripts/run-agent-turns-for-review.js` / `scripts/setup-demo-review.js`（现有 runner / demo 脚本）
- `docs/demo/MVP_Demo_Runbook.md`（API 契约保留边界）

---

## 当前输出文档

- `docs/coordination/Sprint_9.1_Orchestrator_Spine_Contract.md`（9.1 主契约，9.4 的输入基线）
- `docs/coordination/Sprint_9.4_Orchestrator_Spine_Backend.md`（9.4 实现记录）
- `docs/coordination/Sprint_9.5a_MultiRound_Foundation_Backend.md`（9.5a 多轮地基实现记录）
- `docs/coordination/Sprint_9.5b_MultiRound_Debate_Backend.md`（9.5b 多轮回合实现记录，新增）
- `docs/coordination/ACTIVE_SPRINT.md`（本文件，滚动到 9.5b）

---

## 红线

- **改业务代码（本次允许，标准 Gate 范围）**：新增 `orchestrator/` 模块、编辑 `queue.service.ts`/`reviews.service.ts`/`reviews.module.ts`；但**不写密钥**、**不改 schema**（9.2 已加列，9.4 零迁移）、**不改前端**（API 契约保留）、**不改 `REVIEW_STATUS_FLOW` 既有枚举语义**。
- **不运行真实 LLM**：默认 mock provider（`max_cost_per_review=0`）；dev-only lmstudio 试点受 §7 守卫，本次不启用（`MODEL_PROVIDER` 保持 unset/mock）。
- **不写密钥**：仅描述 env 守卫语义；`provider-adapter` 的 `Authorization` 头拼接处不打印；`MODEL_API_KEY` 不落库/不提交。
- **不越界 P2+（9.5b 范围外）**：9.5b 实现 round-2 mock debater（冲突启发式 + phase='debate' 确定性派发）+ 多轮 `[running→summarized]*` 循环 + `max_rounds` 每轮兜底；**不实现**真 LLM Moderator(P2) / `ModelAdapter` 泛化(P2) / `Memory`·`Prompt` Service(P3) / `Tool`·`HITL`(P4) / opinion 校验规则改动 / 任何 schema 变更 / 前端改动。三条 9.5a 须知悉项（`continue_debate→running(r2)`、每轮 `max_rounds` 重校验、`advance_round` 派发 round-2）均已闭合。
- **不执行 git commit / push**：标准 Gate 红线，待 Codex 交 `workbuddy-review` 复审后再决定。
- **文档落点正确**：本实现记录与 `ACTIVE_SPRINT.md` 同目录 `docs/coordination/`。
- 密钥扫描净：扫描仅命中历史 `docs/coordination` 脱敏占位符（`sk-xxxxxxxxxxxxxxxx`），非真实 Key、非本次文件；本次新增/修改源码零命中。

---

## Gate 记录

| Sprint | 状态 |
|---|---|
| 4.0-4.7 | 已通过 qoderwork 复审 |
| 5.1-5.4 | Go（providerSummary 链路落地 + 文档刷新，qoderwork 复审通过） |
| 5.5 | Go（后端 + 前端 5 个 UI 步骤均实测通过） |
| 6.1B | Go（smoke-export 21/21 通过） |
| 6.2 | Go（8 项重点全过；tsc 0 errors；后端导出实跑 2323 字节非空 .md） |
| 6.3 | Go（Workbuddy 快速 Gate 复审通过；§6 三项导出检查待 live demo 实测回填） |
| 6.4 | Go（MVP Release Snapshot 锚点生成，纯文档） |
| 7.0 | Go（真实 Provider 试点总合同；标准流程，7.1 spike 已验） |
| 7.1 | Go（standalone lmstudio spike，8 项全过，2/2 角色成功，无 Key/出域，默认 mock 零影响） |
| 7.1B | Go（spike hygiene 加固：DEBUG_PROVIDER_RAW 门控 + parse 失败 fail-closed，8 项全过） |
| 7.2 | Go（dev-only queue 真实 provider 试点合同；标准流程，7.3 已落地） |
| 7.3 | Go（实现 `MODEL_PILOT_MAX_ROLES` 硬约束 cap=3；默认 mock 零回归；smoke 全绿 + tsc 0 errors） |
| 7.4 | Go（本地 LM Studio dev-only E2E 15/15 PASS；鲁棒性 5/5；单 review ≤3；无泄漏） |
| 7.5 | Go（Demo 就绪冻结；文档语义已锚定，标准 Demo 零 LLM 依赖、LM Studio 仅 dev-only ≤3 capped、付费 API 未启用） |
| **8.1** | **Go**（GitHub 引导完成并推送 `origin/main` `a4da677…`；`.gitignore` 全覆盖；无真实 Key/业务改动；快速 Gate 复审通过） |
| **8.2** | **Go**（Repo Operating Rules 固化，已写入协议 §9；文档随 8.3 提交 `9dbcf97` 入库） |
| **8.3** | **Go**（Documentation Sync Commit；6 个 coordination 文档提交并推送 `9dbcf97`，零业务改动、无真实 Key；workbuddy 快速 Gate 复审通过） |
| **9.0** | **Go**（Architecture Refactor Kickoff；纯文档主文档 `Sprint_9.0_Product_Roadmap_Reset.md` + 本文件滚动到 9.0；fast-gate 复审通过，commit `bbed578` 已推送 `origin/main`） |
| **9.1** | **Go**（P1 Orchestrator Spine Contract；纯文档 Contract `Sprint_9.1_Orchestrator_Spine_Contract.md` + 本文件滚动到 9.1；快速 Gate §7.1 复审通过，基线锚定 `10cec39`，9.2 实现走标准 Gate） |
| **9.2** | **Go**（P1 Additive Schema Migration；2 新表 + 3 既模型加列 + Prisma 迁移实跑 + 历史回填 + 写入点修复；标准 Gate 复审通过，commit `ad5c6cf`） |
| **9.3** | **Go**（P1 Enum Migration + Ref Update；workbuddy-coder 按 §7.6 物理重命名 `Review.status` 枚举 + 重写 `REVIEW_STATUS_FLOW` + 前后端 6 处引用更新 + 修正 9.2 idempotencyKey 回填为语义键；tsc(api+web) 0 errors、Docker 全栈实跑、migration deploy 成功、回填 0 行 PK、3 路冒烟全绿、密钥扫描干净；commit `c7158ab`，为 9.4 graph 脊柱铺好枚举环境） |
| **9.4** | **Go**（P1 Orchestrator Spine（single-round）；graph runtime + ReviewOrchestrator + round-1 + mock Moderator + checkpoint + 幂等；commit `7a8b4e6`） |
| **9.5a** | **Go**（P1 多轮地基；修 P2-1~P2-4：round 贯通 / minRounds 强制 / 条件边真路由 / ReviewStatus 补值；commit `12a6d3a`） |
| **9.5b** | **Go**（P1 收官；round-2 mock debater + continue_debate + 多轮循环 + max_rounds=3 兜底演练；commit `05c9bbf`） |
| **2.1** | **Go**（P2 Model Adapter 抽象层；ModelAdapter 接口 + Mock/AI 双适配器 + 多重护栏工厂；commit `cccb813`） |
| **9.6** | **Go**（GitHub 门面文档；README 重写 + CONTRIBUTING + ARCHITECTURE；commit `cccb813`） |
| **2.2** | **规划中**（P2 真 LLM Moderator 接线 + LM Studio Adapter 实测；待派） |
| **9.5a** | **Go**（P1 Multi-Round Foundation（修 9.4 review P2-1~P2-4）；workbuddy-coder 实现 round 贯通 + minRounds 强制 + 条件边真路由 + ReviewStatus 补 interrupted/archived；tsc(api+web) 0 errors、`prisma migrate deploy` up to date、`apps/api/scripts/verify-9.5a-multiround-foundation.js` 真实实例断言 15/15（P2-1/2/3/4 + 9.4 单轮回归）、standing smoke 31/31 全绿、密钥扫描干净（仅历史 docs 脱敏占位符）；证据文档 `Sprint_9.5a_MultiRound_Foundation_Backend.md` 已就位；9.5b 在其上闭合三条须知悉项，标准 Gate 复审建议 Go） |
| **9.5b** | **In Progress**（P1 Multi-Round Debate Backend（P1 收官）；workbuddy-coder 在 9.5a 多轮地基上实现 round-2 mock debater（冲突启发式 + phase='debate'）+ 多轮 `[running→summarized]*` 循环 + `max_rounds` 每轮重校验双闸，闭合 9.5a review §8 三条须知悉项；改动 `moderator.ts`/`review-orchestrator.ts`/`queue.service.ts` 三文件，零 schema 变更、零前端改动、默认 mock、不调真实 LLM；tsc(api+web) 0 errors、`prisma migrate deploy` up to date、`apps/api/scripts/verify-9.5b-multiround.js` 真实实例断言 **22/22**、standing `smoke-runtime.js` **31/31** 全绿、密钥扫描干净（仅历史 docs 脱敏占位符）；证据文档 `Sprint_9.5b_MultiRound_Debate_Backend.md` 已就位；**未提交**，待 Codex 交 `workbuddy-review` 走标准 Gate 复审） |
