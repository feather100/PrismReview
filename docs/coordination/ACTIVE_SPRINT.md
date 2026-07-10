# ACTIVE SPRINT

> 单一入口：所有 agent 开工前必须先读本文件，确认当前 Sprint 状态、输入/输出文档、负责人与 Gate 状态。
> 本文件随 Sprint 滚动更新，不归档。

---

## 当前状态

- **Current Sprint**: Sprint 7.5
- **Phase**: Real Provider Demo Readiness Freeze（workbuddy-docs 文档冻结，纯文档）
- **Gate Status**: In Progress（文档冻结已采纳；待对外/Demo 实测回填时翻 Go）
- **Last Updated**: 2026-07-10
- **Owner**: workbuddy-docs

---

## 当前目标

冻结当前 Demo 语义边界（workbuddy-docs 纯文档冻结，不改代码）：
- 默认 Mock 可演示（路线 A 纯 mock / 路线 B mock runner + DB opinions），**零 LLM 依赖**；
- LM Studio 仅 dev-only、显式 env guard、单 review ≤3 capped，弱输出 fallback_mock/failed 受控兜底、不代表系统失败；
- openai_compatible / 付费 API 未启用（结构 GUARD，缺 Key 永不静默启用）。
更新 `MVP_Demo_Runbook.md`（§2/§3 LLM 依赖声明 + 新增 §11 Dev-only LM Studio 路线）、`Frontend_Demo_QA_Checklist.md`（新增 §7 真实模型参与可观测性核查）、输出 `Sprint_7.5_Demo_Readiness_Freeze.md`（可演示能力 / 不可宣称能力 / 环境变量矩阵 / 风险与口径），并滚动本文件到 7.5。**只写文档、不运行付费 API、不写密钥、不写本机绝对路径。**

---

## 当前输入文档

- `docs/coordination/Sprint_7.3_Workbuddy_Review.md`（dev-only queue LM Studio 实现复审，Go，无保留；cap=3 硬约束）
- `docs/coordination/Sprint_7.4_LMStudio_Capped_E2E.md`（本地 LM Studio 端到端，15/15 PASS）
- `docs/coordination/Sprint_7.4_Workbuddy_Review.md`（快速 Gate 复审，Go）
- `docs/demo/MVP_Demo_Runbook.md`（本次待刷新：§2/§3 + 新增 §11）
- `docs/demo/Frontend_Demo_QA_Checklist.md`（本次待刷新：新增 §7）
- `docs/coordination/ACTIVE_SPRINT.md`（上一跳 7.2，需补 7.3/7.4 并滚动至 7.5）

---

## 当前输出文档

- `docs/coordination/Sprint_7.5_Demo_Readiness_Freeze.md`（本次冻结主文档）
- `docs/demo/MVP_Demo_Runbook.md`（滚动：§2/§3 LLM 依赖声明 + §11 Dev-only LM Studio 路线）
- `docs/demo/Frontend_Demo_QA_Checklist.md`（滚动：新增 §7 真实模型参与可观测性核查）
- `docs/coordination/ACTIVE_SPRINT.md`（本文件，滚动到 7.5）

---

## 红线

- 不改代码（本次纯文档冻结，不触碰任何 .ts / scripts / schema / 前端）
- 不运行付费 API / openai_compatible（仅描述既有 dev-only lmstudio 证据）
- 不写 API Key（仅 `sk-...` 占位）/ 不写本机绝对路径 / 不写敏感原文
- 不把 fallback_mock / failed 包装成"真实模型成功"，也不把弱输出描述为"系统不可用"
- 不改默认 mock demo 语义（默认实例恒 mock，pilot 仅独立进程内联 env）

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
| 7.4 | Go（本地 LM Studio dev-only E2E 15/15 PASS；鲁棒性 5/5；单 review ≤3；无泄漏；快速 Gate 复审通过） |
| **7.5** | **In Progress**（Demo 就绪冻结；文档语义已锚定，待对外/Demo 实测回填时翻 Go） |
