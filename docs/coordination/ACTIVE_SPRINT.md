# ACTIVE SPRINT

> 单一入口：所有 agent 开工前必须先读本文件，确认当前 Sprint 状态、输入/输出文档、负责人与 Gate 状态。
> 本文件随 Sprint 滚动更新，不归档。

---

## 当前状态

- **Current Sprint**: Sprint 8.2
- **Phase**: Repo Operating Rules（workbuddy-docs 纯文档，GitHub 主干协作规则固化）
- **Gate Status**: In Progress（规则被协议采纳即推进；后续代码 Sprint 实际遵守时由 Gate 持续核查）
- **Last Updated**: 2026-07-10
- **Owner**: workbuddy-docs

---

## 当前目标

把 GitHub 主干协作规则写清楚，避免后续 agent 在错误目录/分支/未同步状态下工作（workbuddy-docs 纯文档，不改业务代码）：
- 新增 `Sprint_8.2_Repo_Operating_Rules.md`（七条强制规则 + 详解 + 提交纪律 + 红线核对）；
- 更新 `AGENT_COORDINATION_PROTOCOL.md` 新增 §9 GitHub 工作规则（开工三连查 / 开工目录 / 禁止包装区 init / 忽略清单 / 文档落点 / 验证命令留痕 / 提交纪律）；
- 滚动本文件到 8.2。
引用 8.1 已建立的 `origin=feather100/PrismReview` + `main` + `.gitignore`。**不改业务代码、不运行模型、不写密钥。**

---

## 当前输入文档

- `docs/coordination/Sprint_8.1_GitHub_Bootstrap.md`（Git 引导完成，已推送 `origin/main` `a4da677…`）
- `docs/coordination/Sprint_8.1_Workbuddy_Review.md`（快速 Gate Go）
- `docs/coordination/AGENT_COORDINATION_PROTOCOL.md`（本次待更新：新增 §9）
- `docs/coordination/ACTIVE_SPRINT.md`（上一跳 7.5）

---

## 当前输出文档

- `docs/coordination/Sprint_8.2_Repo_Operating_Rules.md`（本次规则主文档）
- `docs/coordination/AGENT_COORDINATION_PROTOCOL.md`（滚动：新增 §9 GitHub 工作规则）
- `docs/coordination/ACTIVE_SPRINT.md`（本文件，滚动到 8.2）

---

## 红线

- 不改业务代码（本次纯文档，仅新增/更新文档）
- 不运行模型（无模型调用）
- 不写密钥（仅 `sk-...` 占位格式说明，未写任何真实 Key）
- 不执行提交/推送（规则文档本身不要求提交；本 Sprint 仅写文档）
- 文档落点正确（本文与协议更新均在 `docs/coordination/`）

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
| **8.2** | **In Progress**（Repo Operating Rules 固化；规则写入协议 §9 即推进，待后续代码 Sprint 实际遵守时由 Gate 持续核查） |
