# Sprint 6.2 — Workbuddy 复审（Frontend Markdown Export Button）

> 复审角色：workbuddy（独立审查 / Gate 视角）
> 输入文档：`docs/coordination/Sprint_6.2_Frontend_Markdown_Export.md`（antigravity 前端实现）
> 复审日期：2026-07-09
> 复审方式：代码核对 + `tsc` + 后端导出接口实跑（:4000 已就绪）

---

## 0. 审查范围与证据来源

| 项 | 说明 |
|----|------|
| 前端实现 | `apps/web/src/features/report/ReportPage.tsx`、`apps/web/src/lib/api-client/client.ts` |
| 后端契约（既有） | `apps/api/src/modules/reviews/reviews.controller.ts` `@Get(':reviewId/report/export.md')` |
| tsc 环境 | managed node 22.22.2，`apps/web` 下 `tsc --noEmit` |
| 手动实测 | `curl` 直连 `:4000/api/reviews/{id}/report/export.md`（dev token `test-token`） |
| 代码仓库 | **非 git 仓库**，`git status` 报 `not a git repository` → 无法用 diff 证明“后端未改”，改用“端点既存且一致 + Sprint 范围仅前端两文件”论证（见 §6） |

---

## 1. 逐条核对（8 项重点）

### ✅ 1. 是否只启用 Markdown 导出按钮，PDF/Jira 仍 disabled
`ReportPage.tsx` 验证：
- L166 `<Button disabled icon={<DownloadOutlined />}>导出 PDF</Button>` —— PDF **disabled** ✅
- L167–173 `导出 Markdown` 按钮：带 `onClick={handleExportMarkdown}`、`loading={downloadingMd}`，**无 `disabled`** ✅
- L218 `<Button type="primary" disabled>同步至 Jira (未连接)</Button>` —— Jira **disabled** ✅

仅 Markdown 按钮可点，其余两按钮保持禁用，与 Sprint 要求一致。

### ✅ 2. 是否调用后端 `/report/export.md`，不在前端拼 Markdown
- `client.ts` L289：`axios.get(\`${API_BASE_URL}/reviews/${reviewId}/report/export.md\`)`，且 `API_BASE_URL = 'http://localhost:4000/api'`（L3）→ 实际路径 `/api/reviews/{id}/report/export.md`，与前端文档 §2.1 描述一致 ✅
- 后端 `reviews.controller.ts` L131–141：`@Get(':reviewId/report/export.md')` 内由 `reviewsService.exportMarkdown(...)` 服务端生成 markdown 并经 `res.send(md)` 返回。前端仅把响应体当 blob 触发下载，**不拼接任何 Markdown** ✅
- 前端文档称“前端仅作为文件的搬运工”属实 ✅

### ✅ 3. 是否使用后端 Content-Disposition filename 优先，fallback 合理
- `client.ts` L294：`let filename = \`prismreview-${reviewId}.md\``（fallback）。
- L295–301：读取 `response.headers['content-disposition']`，正则提取 `filename=...`，命中则覆盖 fallback ✅
- 实测后端返回：`Content-Disposition: attachment; filename="prismreview-f067b227.md"`（见 §3），前端解析后得到 `prismreview-f067b227.md`，优先级与 fallback 均合理 ✅
- 小注（P2，非阻塞）：后端文件名取 `reviewId.substring(0, 8)`（L139），前端 fallback 用完整 id——两者格式都合法 `.md`，且后端 header 存在时以前端读到的为准，无功能影响。

### ✅ 4. 是否有 loading 防重复点击和中文失败提示
- `ReportPage.tsx` L30 `const [downloadingMd, setDownloadingMd] = useState(false)`。
- L35 `setDownloadingMd(true)`（点击即锁）；L41 `finally { setDownloadingMd(false) }`（无论成败都解锁）→ **防重复点击** ✅
- L170 `loading={downloadingMd}` 绑定到按钮。
- L38–39 失败分支：`message.error(err.message || '导出 Markdown 失败，请稍后重试。')` —— **中文友好提示** ✅
- `client.ts` L311–316：异常被包装为中文 `导出 Markdown 失败: ...` 后上抛，文案一致 ✅

### ✅ 5. 是否只在 report 成功加载后可点击
按钮位于 L122 主渲染分支。前置守卫：
- L69–77 `if (loading)` 显示 Spin，不渲染按钮；
- L79–96 `if (error)` 显示 Alert，不渲染按钮；
- L98–104 `if (!data)` 显示 Empty，不渲染按钮。
只有 `loading=false && error=null && data` 命中时才渲染 Header 与导出按钮 → **report 成功加载后才可点** ✅

### ✅ 6. 是否未改后端 / schema / 模型逻辑
- Sprint 6.2 改动仅落在前端两文件：`client.ts`（新增 `exportReportMarkdown`）、`ReportPage.tsx`（按钮启用 + loading + 文案）。
- 后端导出端点 `reviews.controller.ts` L131–141 **在本次 Sprint 前已存在**（前端文档亦称“基于后端已实现的报告导出接口”），本次未改动控制器、service、`exportMarkdown` 实现。
- 未触及任何 `.prisma` / schema / 模型 / 状态机。
- 限制说明：当前目录**非 git 仓库**，无法提供 diff 形式的“零后端变更”证据；以上结论基于端点既存一致性 + Sprint 交付物范围判定。建议后续接入 VCS 以便 Gate 留痕。

### ✅ 7. tsc 是否通过
- 命令：`apps/web` 下 `node_modules/typescript/bin/tsc --noEmit`（managed node 22.22.2）。
- 结果：**0 errors，EXIT=0** ✅
- 前端文档 §3 宣称“0 errors”属实，独立复测一致。

### ✅ 8. 如可手测，点击按钮是否下载 .md 文件，文件内容非空
- 后端实跑（:4000 已就绪）：`GET /api/reviews/f067b227-0069-48f7-8859-e772dd2fb71e/report/export.md`
  - HTTP 200；`Content-Type: text/markdown; charset=utf-8`
  - `Content-Disposition: attachment; filename="prismreview-f067b227.md"`
  - 响应体 **2323 字节**，非空，首行 `# PrismReview 评审报告`，含标题/结论/意见等结构化 Markdown ✅
- 该响应即前端按钮将下载的精确字节；前端 `exportReportMarkdown` 用 `blob + <a download> + URL.revokeObjectURL` 标准下载链路（L303–310），文件名取自上述 header。
- 结论：**文件内容非空且命名正确**，后端实跑已验证；前端点击→下载的接线为标准浏览器行为，代码已核对一致。
- 说明：未在 headless 浏览器中执行真实“点击→落盘”端到端（需 Chromium 下载，成本较高）；但数据层与接线层均已实证。如需 100% 浏览器内落盘证据，可在 :3000 起的前提下补一次 agent-browser 点击（登记 P2 可选）。

---

## 2. 红线复核（协议 §5）

| 红线 | 结果 |
|------|------|
| antigravity 不得猜 API 字段 | 所用字段（`/report/export.md`、`content-disposition`、`blob`）均在既有后端契约内，无猜测 ✅ |
| 不得自行推断状态机 | 未新增/改动任何 `status` 流转，仅启用已有按钮 ✅ |
| qoderwork 不改代码 | 本复审只读不改 ✅ |
| reasonix 不随意改 schema | 本次无 schema 变更 ✅ |
| 真实 LLM/RAG/Runner/Queue 需单独 Gate | 本次为纯前端下载交互，不涉及真实推理/队列核心 ✅ |

---

## 3. 验证证据索引

- `tsc`：`apps/web` `tsc --noEmit` → 0 errors（2026-07-09，managed node 22.22.2）。
- 后端导出实跑：`GET /api/reviews/f067b227-.../report/export.md` → 200，`Content-Disposition: attachment; filename="prismreview-f067b227.md"`，2323 字节非空 Markdown。
- 代码锚点：`client.ts` L287–317、`ReportPage.tsx` L30 / L34–43 / L69–104 / L166 / L167–173 / L218；`reviews.controller.ts` L131–141。

---

## 4. P0 / P1 / P2 清单

- **P0**：无。
- **P1**：无（8 项全部通过，无阻塞）。
- **P2（留档，不阻塞）**：
  1. 后端文件名取 id 前 8 位、前端 fallback 用完整 id，命名略有差异（功能无影响）。
  2. 当前目录非 git 仓库，缺 diff 留痕机制；建议接入 VCS 以便 Gate 证据可审计。
  3. 可选：在 headless 浏览器补一次“点击→.md 落盘”端到端；或在 `smoke-export.js`（Sprint 6.1B 既有）中追加前端导出冒烟。

---

## 5. Gate 结论

**Gate: Go ✅**

8 项重点全部满足，tsc 0 errors，后端导出接口实跑返回非空且命名正确的 Markdown，无任何 P0/P1。P2 三条均为留档项，不阻塞本 Sprint。

下一跳建议：进入 6.3（如规划）；P2 #2（接入 VCS）建议排期处理。
