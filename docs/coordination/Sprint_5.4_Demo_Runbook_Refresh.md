# Sprint 5.4 — Observability Demo Runbook Refresh

> 类型：文档刷新 Sprint（纯文档，无代码变更）
> 模式：快速 Gate（协议 §7 — 不改 schema / 不改状态机 / 不涉及真实 LLM 首次接入 / 不改前端主页面 / 不引入新外部依赖）
> Owner：workbuddy
> 日期：2026-07-09
> 协作协议：`docs/coordination/AGENT_COORDINATION_PROTOCOL.md`

---

## 1. 背景与目标

Sprint 5.1–5.3 已落地"生成来源摘要 / 来源可观测性"能力：

- **Sprint 5.1（Backend，Gate: Go）**：`queue.service.ts` 在 `executeAgentTurn()` 把 `modelOutputRef` 落库为结构化 JSON，含 `providerSource` ∈ `{mock, lmstudio, openai_compatible, fallback_mock, failed}`、`fallback`、`modelName`、`durationMs`。零 schema / 前端 / Report API / SSE 改动。
- **Sprint 5.2（Backend，Gate: Go）**：Report API 新增 optional `providerSummary` 字段 `{ totalTurns, bySource, fallbackCount, failedCount, models, hasRealProvider }`，仅读 DB 不调模型，parse 失败回退 `mock`，绝不泄漏 Key/prompt/rawText。
- **Sprint 5.3（Frontend，Gate: Go）**：`ReportPage.tsx` 新增"生成来源摘要"模块，`&&` 短路守卫（缺失不崩），展示五态分布 + 蓝/橙/红条件标签。

但 **`docs/demo/` 下的演示与 QA 文档仍是旧版**，未描述该能力。本 Sprint 目标：**刷新 Demo / QA 文档，让文档与当前系统能力一致，尤其 providerSummary / 来源可观测性**。

> 本 Sprint **只改文档、不运行任何模型、不改 API、不改代码**。

---

## 2. 本次文档变更明细

### 2.1 `docs/demo/MVP_Demo_Runbook.md`

| 改动 | 位置 | 内容 |
|------|------|------|
| 路线 A 步骤注释 | §2.2 步骤 3 | 注明 Report 底部"生成来源摘要"显示 `Mock(N)`，无真实模型标签 |
| 路线 B 步骤注释 | §3.2 步骤 3 | 注明 Report 底部"生成来源摘要"显示各角色 provider 分布 |
| 新增 §8 生成来源摘要 | 全文新增 | 五态 `providerSource` 含义表、摘要模块展示内容、缺失时不崩说明、MVP 无需真实 LLM 论证 |
| 新增 §9 一致性说明 | 全文新增 | 声明对应 Sprint 5.1–5.3、纯文档不改动代码、快速 Gate 适用 |

§8 关键内容摘录：

- **五态含义**：`mock`（默认，无标签）/ `lmstudio`（真实，计入"真实模型参与"）/ `openai_compatible`（真实，计入"真实模型参与"）/ `fallback_mock`（回退，`fallback:true`，计入"已发生 Fallback"）/ `failed`（guard·401·403，`fallback:false`，计入"存在失败 Turn"）。
- **展示**：总发言数 = `totalTurns`；分布 `Mock(N)/LMStudio(N)/OpenAI(N)/Fallback(N)/Failed(N)`；条件标签蓝/橙/红。
- **缺失不崩**：`providerSummary` 为 optional，前端 `&&` 短路跳过整块，页面其余正常。
- **MVP 零真实依赖**：默认路线 A/B 均为 `mock`，摘要显示 `Mock(N)`；仅显式设置 `MODEL_PROVIDER` 才出现真实模型分布。

### 2.2 `docs/demo/Frontend_Demo_QA_Checklist.md`

| 改动 | 位置 | 内容 |
|------|------|------|
| 新增 §5 生成来源摘要 | 全文新增 | 5 项 Demo QA 检查：providerSummary 展示、缺失不崩、fallback/failed 标签语义、零敏感泄漏、中文文案一致性 |

### 2.3 `docs/coordination/ACTIVE_SPRINT.md`

滚动至 Sprint 5.4（Phase: Observability Demo Runbook Refresh，Gate Status: In Progress，Owner: workbuddy），并同步 Gate 表：

- 4.0-4.7 已通过 qoderwork 复审；
- 5.1-5.3 Go（providerSummary 链路落地）；
- 5.4 当前 In Progress。

> 此同步闭环了 Sprint 5.1 P2-3、5.2 P2-3、5.3 P2-1 反复标记的「ACTIVE_SPRINT.md 仍显示 4.7，应在下一 Sprint 前同步」。

---

## 3. 红线遵守声明

| 红线 | 是否遵守 |
|------|----------|
| 不改代码 | ✅ 仅 `.md` 文档 |
| 不运行真实模型 | ✅ 未执行任何模型/脚本 |
| 不改 API | ✅ 未触碰 `reviews.service.ts` / controller / gateway |
| 不改 schema | ✅ 未改 `schema.prisma` |
| 不改状态机 | ✅ 未改 Review.status 流转 |
| 不接 LLM / RAG / Runner / Queue | ✅ 纯文档 |

---

## 4. Gate 证据与结论

### 4.1 本次 Sprint 性质

纯文档刷新，无代码变更，故**无 tsc / smoke / 手动验收证据需求**（协议 §8 同 Sprint 3.11 文档类 Sprint 处理）。

### 4.2 一致性证据（文档 ↔ 已落地代码能力）

| 文档陈述 | 对应已落地能力 | 来源 |
|----------|----------------|------|
| 五态 `providerSource` 含义 | `modelOutputRef.providerSource` 值域 | Sprint 5.1 复审 证据 2 |
| 摘要字段结构 | `providerSummary` DTO | Sprint 5.2 复审 证据 1 |
| 缺失不崩（`&&` 守卫） | `ReportPage.tsx` `providerSummary && (...)` | Sprint 5.3 复审 证据 1 |
| 标签语义（蓝/橙/红） | `hasRealProvider` / `fallbackCount` / `failedCount` | Sprint 5.3 复审 证据 4 |
| MVP 零真实依赖 | 默认 mock，`MODEL_PROVIDER` 可选 | Sprint 5.1/5.2/5.3 + Runbook §4.4 |

### 4.3 P0 / P1 / P2 评估

- **P0**：无（未改 schema / 状态机 / 未猜字段 / 未绕过契约 / 真实集成已各自 Gate）。
- **P1**：无。
- **P2**：无新增；原 5.1/5.2/5.3 的 P2（ACTIVE_SPRINT 同步）已在本 Sprint 闭环。

### 4.4 Gate 结论建议

**Go（建议）** — 纯文档刷新，内容严格对应 Sprint 5.1–5.3 已 Gate:Go 的落地能力，未引入任何代码/契约变更，符合快速 Gate 触发条件（协议 §7.1 全部满足）。待 Codex / 用户侧 Gate 确认即视为通过。

---

## 5. 下一步建议

- **Sprint 5.5（候选）— Demo 实测回填**：按刷新后的 Runbook / QA Checklist 实际跑一遍路线 A/B，把"五态标签在真实页面上的截图/验收结论"回填到 Demo 文档，形成闭环证据。
- 或回补 **Sprint 3.12 — Review Timeline P2 Cleanup**（长期延后的 P2 清理）。
