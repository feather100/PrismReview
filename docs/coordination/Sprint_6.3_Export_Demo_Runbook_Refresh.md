# Sprint 6.3 — Export Demo Runbook Refresh

> 模式：文档刷新（协议 §7 快速 Gate 适用：不改 schema / 不改状态机 / 不涉及真实 LLM 首次接入 / 不改前端主页面 / 不引入新外部依赖）
> 负责人：workbuddy-docs
> 日期：2026-07-09
> 范围：**只改文档，不改代码**

---

## 1. 目标

把 Sprint 6.0（导出契约）/ 6.1（后端 `GET /api/reviews/{id}/report/export.md`）/ 6.2（前端"导出 Markdown"按钮启用）已落地的导出能力，刷新进 Demo 文档，使演示者能正确展示导出行为并澄清边界（PDF/Jira 仍未接入、默认 mock 即可导出）。

---

## 2. 输入文档（开工前已读）

- `docs/coordination/ACTIVE_SPRINT.md`（上一跳 6.2）
- `docs/coordination/Sprint_6.0_Markdown_Export_Contract.md`（端点 / 响应头 / Markdown 结构 / 安全脱敏 / 状态机）
- `docs/coordination/Sprint_6.1_Workbuddy_Review.md`（后端实现复审，Go）
- `docs/coordination/Sprint_6.1B_Export_Smoke_Hardening.md`（smoke 加固 21/21）
- `docs/coordination/Sprint_6.2_Workbuddy_Review.md`（前端按钮复审，Go）
- `docs/demo/MVP_Demo_Runbook.md`（本次刷新）
- `docs/demo/Frontend_Demo_QA_Checklist.md`（本次刷新）

---

## 3. 变更清单

### 3.1 `docs/demo/MVP_Demo_Runbook.md`

| 位置 | 变更 |
|------|------|
| §2.2 路线 A 演示步骤 | 新增**步骤 4**：点击报告页右上角"导出 Markdown" → 浏览器下载 `prismreview-{id前8位}.md`，文件非空，含评审标题/目标/结论/来源摘要/风险/意见 |
| §3.2 路线 B 演示步骤 | 新增**步骤 5**：同路线 A 的导出验证（内容与 DB opinions 报告一致） |
| §10（新增）报告页导出说明 | 10.1 按钮位置与启用条件（仅 completed 且加载后可点、loading 防连击、中文失败提示）；10.2 **PDF/Jira 仍 disabled**（表格列明三按钮状态）；10.3 导出 Markdown 含哪些章节（header/verdict/providerSummary/executiveSummary/metrics/risks/opinions/actionItems/lowConfidenceItems + 安全禁出）；10.4 **默认 mock 路线也能导出，无需真实模型**（复用 getReport、不调 provider）；10.5 文件命名（Content-Disposition 优先 + fallback）与验证（含可选 curl 自测） |

### 3.2 `docs/demo/Frontend_Demo_QA_Checklist.md`

| 位置 | 变更 |
|------|------|
| §3 已知限制 | 修正旧表述：原"导出 PDF、导出 Markdown、同步至 Jira 均已 Disabled" → 改为"导出 PDF、同步至 Jira 均已 Disabled；**导出 Markdown 已在 Sprint 6.2 启用**" |
| §6（新增）报告导出检查 | 三项未勾选检查：① Markdown 导出按钮可点击（非 disabled + loading 防连击）；② PDF/Jira 仍 disabled；③ 下载文件名（`prismreview-{前8位}.md` / fallback）+ 非空内容（首行 `# PrismReview 评审报告`，含 objective/verdict/providerSummary/risks/opinions，且不含 rawText/prompt/API Key/modelOutputRef）。并附"实测状态回填（待 Sprint 6.3 Demo 执行）"说明，引用 6.1/6.1B/6.2 已实跑的后端证据 |

---

## 4. 红线遵守

| 红线 | 遵守情况 |
|------|----------|
| 不改代码 | ✅ 仅编辑两份 demo 文档 + ACTIVE_SPRINT，未触碰任何 `.ts` / 契约 / schema |
| 不调用真实模型 | ✅ 文档仅描述默认 mock 演示行为；明确"导出复用 getReport，不调 provider/不消耗付费 API" |
| 不写本机绝对路径 / 敏感信息 | ✅ 文档沿用相对路径（`apps/api`、`scripts/...`）；未写入 API Key / prompt / rawText / 绝对路径；下载文件名示例用 `{id前8位}` 占位 |

---

## 5. 验证证据

- **本次为纯文档刷新，无需 tsc / smoke**（未改代码）。
- **后端导出能力已在历史 Sprint 实跑验证（等价证据）**：
  - Sprint 6.1 复审：`reviews.controller.ts:131` `@Get(':reviewId/report/export.md')` 端点、响应头、状态机、verdict/objective/generatedAt/providerSummary 全覆盖、零敏感字段泄漏 → **Go**。
  - Sprint 6.1B：`scripts/smoke-export.js` **21/21 通过**（含 providerSummary / mock_fallback 路径 / 无 API Key·prompt·sk- 断言）。
  - Sprint 6.2 复审：`curl` 实跑 `:4000/api/reviews/{id}/report/export.md` → 200 + `Content-Disposition: attachment; filename="prismreview-{前8位}.md"` + 2323 字节非空 `text/markdown` → **Go**；前端 `tsc` 0 errors。
- Demo 文档 §6 三项导出检查**待下一次 live demo（路线 A/B 的 completed review）实测回填**后，方可进入 Gate 终判。

---

## 6. Gate 状态

**Gate: In Progress（待 Demo 实测回填）**

文档刷新已完成，内容与前序契约/实现/复审一致，红线全守。§6 三项导出 QA 检查项为新增、尚未在浏览器端到端实测，建议在下一次 live demo 执行并回填 ✅/⚠️ 与截图证据后，由 Gate 给出 Go / No-Go。

---

## 7. 后续动作

1. 下一次 live demo 中实测 §6 三项导出检查，回填 `Frontend_Demo_QA_Checklist.md` §6 的"实测状态回填"表 + 截图（建议 `docs/demo/screenshots/sprint-6.3/export-markdown.png`）。
2. 实测通过后，将 `ACTIVE_SPRINT.md` 的 6.3 Gate 记录由 In Progress 翻为 Go。
3. 若导出交互发现异常，回到 Sprint 6.2 前端文档或 Sprint 6.1 后端文档走修复流程（不在此文档内改代码）。
