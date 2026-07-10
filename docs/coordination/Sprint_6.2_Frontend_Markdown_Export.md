# Sprint 6.2 — Frontend Markdown Export Button

## 1. 概览

基于后端已实现的报告导出接口，本次 Sprint 在报告页面 (ReportPage) 成功启用了“导出 Markdown”功能。全程通过标准流程交付，未修改状态机与后端逻辑，仅实现了安全的点击下载交互。

## 2. 接口封装与浏览器交互

### 2.1 `client.ts` 增强
在 `apiClient` 中新增了 `exportReportMarkdown(reviewId)` 方法：
- 调用 HTTP 接口 `GET /api/reviews/{id}/report/export.md`。
- 设置 `responseType: 'blob'` 截获文件流。
- 解析 `Content-Disposition` HTTP 响应头，优先采用后端设定的文件名称（如果可用），否则以稳妥的 `prismreview-{reviewId}.md` 作为备用 fallback 文件名。
- 采用隐式创建 DOM 节点 `<a href="blob:..."/>` 的经典方式在浏览器中静默触发下载操作，然后安全地清理内存对象 `URL.revokeObjectURL`。

### 2.2 `ReportPage.tsx` 页面级调整
- 解除了 `导出 Markdown` 按钮的 `disabled` 属性。
- 为按钮绑定了 `loading={downloadingMd}` 防连击态，保证了点击后文件生成阶段的锁定时效。
- 所有的异常抛出均通过 `message.error` 提供中文友好的降级提示。

## 3. 约束对齐验证

- **隔离性**：PDF 导出与 Jira 同步按钮依然保持在 `disabled` 状态，符合 Sprint 要求。
- **无状态变更**：前端在此仅作为文件的搬运工，不对 Markdown 本身进行组装或渲染。
- `apps/web tsc` 检查：**0 errors** ✅。

## 4. Frontend Gate
**Go ✅** - Markdown 导出体验完整无缺漏。
