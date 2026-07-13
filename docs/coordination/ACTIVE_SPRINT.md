# ACTIVE SPRINT

> 单一入口：所有 agent 开工前必须先读本文件，确认当前 Sprint 状态、输入/输出文档、负责人与 Gate 状态。
> 本文件随 Sprint 滚动更新，不归档。

---

## 当前状态

- **Current Sprint**: Sprint 9.3
- **Phase**: P1 Enum Migration + Ref Update（workbuddy-coder 实现；枚举物理重命名 §7.6 + 前后端引用更新 + idempotencyKey 回填修正，不实现 graph runtime/Moderator/round-2/checkpoint）
- **Gate Status**: In Progress（标准 Gate；代码 + 证据就绪，待 Codex 交 `workbuddy-review` 复审）
- **Last Updated**: 2026-07-13
- **Owner**: workbuddy-coder

---

## 当前目标

在 9.1 Contract（§6 / §7.2–7.5）基础上实做**加性（additive-only）schema 迁移**（workbuddy-coder 实现，标准 Gate）：
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

- `docs/coordination/Sprint_9.1_Orchestrator_Spine_Contract.md`（本次主文档，新增）
- `docs/coordination/ACTIVE_SPRINT.md`（本文件，滚动到 9.1）

---

## 红线

- 不改业务代码（本次纯文档，仅新增/更新文档；未碰任何 `.ts`/`.tsx`/`.prisma`）
- 不运行模型（无模型调用）
- 不写密钥（仅描述 env 守卫语义，未写任何真实 Key）
- **不动 Prisma schema / 不改状态机实现**：本 Sprint 仅**声明** schema delta 与目标状态机（§1/§7），**实施**在 9.2 走标准 Gate（协议 §5.2/§5.4）
- 不执行提交/推送（文档就绪后回报 Codex，由 Codex 走 fast-gate 再决定）
- 文档落点正确（主文档 `docs/coordination/`、本文件同目录）

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
| **9.3** | **In Progress**（P1 Enum Migration + Ref Update；workbuddy-coder 按 §7.6 物理重命名 `Review.status` 枚举 + 重写 `REVIEW_STATUS_FLOW` + 前后端 6 处引用更新 + 修正 9.2 idempotencyKey 回填为语义键；tsc(api+web) 0 errors、Docker 全栈实跑、migration deploy 成功、回填 0 行 PK、3 路冒烟全绿、密钥扫描干净；发现 `Review.status` 为 text 列非原生枚举（无 DROP VALUE 风险）；knowledge.service 的 `ready` 属 `KnowledgeDocument.status` 未越界；证据文档 `Sprint_9.3_Enum_Migration_Backend.md` 已就位；**未提交**，待 Codex 交 `workbuddy-review` 走标准 Gate 复审） |
