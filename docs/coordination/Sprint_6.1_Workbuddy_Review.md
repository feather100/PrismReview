# Sprint 6.1 — Report Markdown Export Backend API 标准流程复审

> 模式：标准流程（协议 §2 Backend 实现阶段，契约 Sprint 6.0 已 Go）
> 复审人：WorkBuddy（只读标准复审）
> 复审时间：2026-07-09 21:01
> 复审依据：`reviews.controller.ts`(:131–141) + `reviews.service.ts`(`exportMarkdown` :446–521 / `assertReview` :525–536 / `getReport` :279–409) + `report-response.dto.ts` + `scripts/smoke-export.js` + `apps/web/.../ReportPage.tsx`(:154–155) + `Sprint_6.0_Markdown_Export_Contract.md` 交叉核对
> 说明：本复审验证 6.1 后端实现是否符合 6.0 契约，并确认无 schema / 前端改动。

---

## 结论：**Go（无保留）**

实现与 6.0 契约逐条对齐，8 项检查中 7 项完整通过；Check #7（smoke 覆盖）为**部分满足**但属**非阻塞**——缺的是 3 条附加断言（providerSummary 显式断言 / mock_fallback 路径 / API Key·prompt 禁出断言），实现代码本身在所有实质性维度均正确且安全，且 smoke 已覆盖关键集成路径（db_opinions 经真实队列跑通）、状态机、响应头、verdict、generatedAt、rawText / modelOutputRef 禁出。详见下方 Check #7。

---

## 八项检查

| # | 检查 | 结果 | 关键依据 |
|---|------|------|---------|
| 1 | endpoint / headers 符合 6.0 契约 | ✅ | `reviews.controller.ts:131` `@Get(':reviewId/report/export.md')` 与契约端点一致；`:138` `Content-Type: text/markdown; charset=utf-8`、`:139` `Content-Disposition: attachment; filename="prismreview-<id前8位>.md"` 与契约 §1 逐字吻合 |
| 2 | 复用 getReport，不调 provider / 真实模型 | ✅ | `:448` `const report = await this.getReport(reviewId, user)` 直接复用聚合逻辑；`exportMarkdown` 全程仅读取 `report.*` DTO 字段，无任何 provider-adapter / 模型调用 |
| 3 | 仅 completed 可导出，未完成拦截 | ✅ | `:447` `assertReview(reviewId, tenantId, ['completed'])`；`assertReview`(:530–534) 状态不符则 `BadRequestException`；`:134` `ParseUUIDPipe` 处理非法 UUID→400；不存在→`NotFoundException`→404。draft/diagnosing/ready/running/interrupted/failed 全拦截 |
| 4 | Markdown 含 objective / verdict / generatedAt / providerSummary / 主要字段 | ✅ | `:459` objective；`:468` 评审结论（`verdictLabel` 由 `:452` `verdictMap[...] \|\| '未给出'` 映射）；`:463` generatedAt=`new Date().toISOString()` 导出时刻；`:470–479` providerSummary 仅计数+models；title/status/mode/source/opinionCount/generatedFromTurns/executiveSummary/metrics(5)/risks/opinions/actionItems/lowConfidenceItems 全覆盖，且与 `report-response.dto.ts` 字段逐一对应 |
| 5 | 无 rawText / prompt / API Key / modelOutputRef 原始 JSON 泄漏 | ✅ | 导出仅用 `ReportResponseDto` 字段，该 DTO 不含 rawText / prompt / API Key / modelOutputRef（modelOutputRef 仅在 `getReport` 内部 `:421` 解析计数，不入 DTO）；`:450` 起无任何原始引用字段 |
| 6 | 表格 escaping 防破表 | ✅ | `:450` `esc = s => (s\|\|'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ')` 同时转义 `\|` 与换行；risks(:491) / actionItems(:509) / lowConfidence(:515) 所有单元格均经 `esc()`，数值列（confidenceScore 等）天然安全 |
| 7 | smoke 覆盖 header / 状态机 / mock·db / providerSummary / 敏感禁出 | ⚠️ 部分（非阻塞） | 已覆盖：`Status 200`(:54)、`Content-Type`(:55)、`Content-Disposition`(:56)、`title`/`objective`(:57–58)、`## 评审结论`(:59)、`generatedAt ISO`(:60)、`无 modelOutputRef`(:61)、`无 rawText`(:62)、`draft→400`(:67)、`不存在→404`(:71)。**缺口（建议补，不阻塞）**：① 未显式断言 `## 生成来源摘要` / providerSummary 出现（db 路径实际已含，仅缺断言）；② 仅测 db_opinions 路径（队列跑通），未单独造 mock_fallback（无 DB opinions 的 completed）review —— 但 export 渲染按 source 无关，db 路径已覆盖同段渲染代码；③ 敏感禁出仅断言 rawText / modelOutputRef，未断言 API Key / prompt（结构上 DTO 无此字段，导出不可能含，属附加断言） |
| 8 | 无 schema / 前端改动 | ✅ | 实现仅用既有 `prisma.review` / `reviewOpinion` 与 `ReportResponseDto`，无新增迁移 / 字段 / 表；前端 `ReportPage.tsx:154–155` 导出按钮仍为 `disabled`（启用属 6.2），6.1 未动前端 |

---

## 标准流程结论

Sprint 6.1 后端实现是契约的忠实落地：端点与响应头逐字对齐、复用 `getReport` 零 provider 调用、状态机严格（仅 completed）、Markdown 覆盖全部主要字段含 verdict（中文映射 + unknown fallback）/ objective / generatedAt（导出时刻）/ providerSummary（仅计数）、表格 escaping 防破表、无任何敏感字段泄漏、未改动 schema 与前端。

**唯一待补（P2，非阻塞，建议 6.2 前完成）**：`scripts/smoke-export.js` 增加 3 条断言 ——
1. 断言响应体含「## 生成来源摘要」且 providerSummary 计数出现；
2. 增加一条 mock_fallback 路径（completed 但无 DB opinions）的导出用例；
3. 断言响应体不含 `API Key` / `prompt` / `sk-` 模式（结构性已保证，补断言加固）。

实现本身质量达标，**Gate = Go（无保留）**，可进入 6.2 前端按钮启用。
