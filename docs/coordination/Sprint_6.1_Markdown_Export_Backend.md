# Sprint 6.1 — Markdown Export Backend API

> 实现 SaaS 6.0 契约的 Markdown 导出后端 API。

---

## 1. 新增端点

```
GET /api/reviews/{id}/report/export.md
  → Content-Type: text/markdown; charset=utf-8
  → Content-Disposition: attachment; filename="prismreview-{8chars}.md"
  → 200: Markdown 文件
  → 400: review 非 completed
  → 404: review 不存在
```

## 2. 修改文件

| 文件 | 变更 |
|---|---|
| `reviews.controller.ts` | 新增 `@Get(':reviewId/report/export.md')` + `Res` |
| `reviews.service.ts` | `exportMarkdown()` — 复用 `getReport()`，构建 Markdown |
| `scripts/smoke-export.js` | 新增 11 个测试 |

## 3. Markdown 章节

1. 标题 + 元信息（title/objective/reviewId/generatedAt等）
2. 评审结论（verdict 中文映射）
3. 生成来源摘要（providerSummary）
4. 执行摘要
5. 评审指标
6. 风险清单
7. 各角色评审意见
8. 改进行动项
9. 低置信度意见

## 4. 安全

- rawText / modelOutputRef / API Key 不导出
- 表格字段 `esc()` 转义 `\|` 和换行

## 5. 验证

```
smoke-export:  11/11 ✅
smoke-runtime: 31/31 ✅
tsc:            0 errors ✅
```
