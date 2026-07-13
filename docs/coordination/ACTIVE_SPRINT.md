# ACTIVE SPRINT

> 单一入口：所有 agent 开工前必须先读本文件，确认当前 Sprint 状态、输入/输出文档、负责人与 Gate 状态。
> 本文件随 Sprint 滚动更新，不归档。

---

## 当前状态

- **Current Sprint**: Sprint 9.0
- **Phase**: Architecture Refactor Kickoff（workbuddy-docs 纯文档，architecture lock + 6 阶段路线图固化）
- **Gate Status**: In Progress（纯文档，符合快速 Gate 触发条件 §7.1；待 Codex 走 fast-gate 审后推进）
- **Last Updated**: 2026-07-13
- **Owner**: workbuddy-docs

---

## 当前目标

把 Codex（总协调）与用户已锁定的三项承重架构决策固化为单一事实来源（architecture lock + 6 阶段路线图），供后续 9.1+ 代码 Sprint 遵循（workbuddy-docs 纯文档，不改业务代码）：
- 新增 `docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md`（主文档：三项决策原样 + Graph 脊柱/Code 叶子 + Moderator 硬闸 + 9 模块架构 + 模型路由 + Memory 分层 + Prompt 架构 + 现状映射 + P0–P6 路线图 + P1 范围 + 红线/ Gate 自检）；
- 滚动本文件到 9.0，并补 8.3 Go 行（当前 Gate 表缺失）+ 9.0 In Progress 行。
引用 8.3 已完成的 MVP Demo RC（commit `9dbcf97`）+ `docs/demo/MVP_Demo_Runbook.md` 现状锚点。**不改业务代码、不运行模型、不写密钥、未执行 git commit。**

---

## 当前输入文档

- `docs/coordination/ACTIVE_SPRINT.md`（上一跳 8.2，本次滚动到 9.0）
- `docs/coordination/AGENT_COORDINATION_PROTOCOL.md`（§7 快速 Gate / §9 GitHub 工作规则）
- `docs/coordination/Sprint_8.3_Workbuddy_Review.md`（最近 Gate Go）
- `docs/coordination/Sprint_8.3_Documentation_Sync_Commit.md`（commit `9dbcf97`）
- `docs/coordination/MVP_RELEASE_SNAPSHOT.md`（MVP 锚点）
- `docs/demo/MVP_Demo_Runbook.md`（现状能力锚点）

---

## 当前输出文档

- `docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md`（本次主文档，新增）
- `docs/coordination/ACTIVE_SPRINT.md`（本文件，滚动到 9.0）

---

## 红线

- 不改业务代码（本次纯文档，仅新增/更新文档；未碰任何 `.ts`/`.tsx`/`.prisma`）
- 不运行模型（无模型调用）
- 不写密钥（仅描述 env 守卫语义，未写任何真实 Key）
- 不动 Prisma schema / 不改状态机实现（仅描述目标架构）
- 不执行提交/推送（文档就绪后回报 Codex，由 Codex 走 fast-gate 再决定）
- 文档落点正确（主文档 `docs/roadmap/`、本文件 `docs/coordination/`）

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
| **9.0** | **In Progress**（Architecture Refactor Kickoff；纯文档主文档 + 本文件滚动到 9.0；符合快速 Gate §7.1，待 Codex 走 fast-gate 审后推进） |
