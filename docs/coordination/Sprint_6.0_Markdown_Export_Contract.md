# Sprint 6.0 — Report Markdown Export Contract

> 设计 Report Markdown Export 的最小可交付方案。
> 只写合同，不改代码。标准流程，不走快速 Gate。

---

## 1. API 方案

### 端点

```
GET /api/reviews/{id}/report/export.md
```

### 响应头

```
Content-Type: text/markdown; charset=utf-8
Content-Disposition: attachment; filename="prismreview-{reviewId前8位}.md"
```

### 状态码

| 状态 | 含义 |
|---|---|
| `200` | 导出成功 |
| `400` | review status 不允许导出（非 completed） |
| `400` | 非法 UUID |
| `404` | review 不存在 |

### 实现方案

复用现有 `getReport()` 的聚合逻辑，用 `ReportResponseDto` 数据填充 Markdown 模板。不新增 DB 查询，不调用 provider，不调真实模型。

文件名使用 `reviewId` 前 8 位：`prismreview-abc12345.md`。

---

## 2. 数据来源

| 字段 | 来源 |
|---|---|
| title, reviewId, objective, status, mode | `GET /api/reviews/{id}` |
| source, opinionCount, generatedFromTurns | `getReport()` 返回值 |
| verdict | `getReport().verdict` |
| providerSummary | `getReport().providerSummary`（如有） |
| executiveSummary | `getReport().executiveSummary` |
| metrics | `getReport().metrics` |
| risks[] | `getReport().risks` |
| opinions[] | `getReport().opinions` |
| actionItems[] | `getReport().actionItems` |
| lowConfidenceItems[] | `getReport().lowConfidenceItems` |
| generatedAt | `new Date().toISOString()`（导出时生成，非 report 原生字段） |

**不重新调用 provider。不调用真实模型。**

---

## 3. Markdown 内容结构

```markdown
# PrismReview 评审报告

**评审标题**: {title}
**评审目标**: {objective}
**Review ID**: {reviewId}
**状态**: {status}
**模式**: {mode}
**生成时间**: {generatedAt}（导出时生成，非 report 原生字段）
**数据来源**: {source} (db_opinions / mock_fallback)
**意见数量**: {opinionCount}
**真实生成**: {generatedFromTurns ? '是' : '否（Mock 模拟）'}

---

## 评审结论

**结论**: {verdictLabel}

{verdict} → 中文映射：

| verdict 值 | 中文显示 |
|---|---|
| approved | 通过 |
| conditionally_approved | 有条件通过 |
| rejected | 不通过 |
| 其他 / missing | 未给出 |

---

## 生成来源摘要

{providerSummary 信息}

- 总轮次: {totalTurns}
- Mock 生成: {bySource.mock || 0}
- LM Studio: {bySource.lmstudio || 0}
- 外部模型: {bySource.openai_compatible || 0}
- 回退 Mock: {fallbackCount}
- 失败: {failedCount}
- 使用模型: {models.join(', ')}

---

## 执行摘要

{executiveSummary}

---

## 评审指标

- P0 风险数: {metrics.p0RiskCount}
- 风险总数: {metrics.totalRiskCount}
- 建议采纳率: {metrics.adoptionRate}%
- 评审耗时: {metrics.durationMinutes} 分钟
- 参审角色: {metrics.totalRoles}

---

## 风险清单

| # | 风险等级 | 来源 | 维度 | 描述 |
|---|---|---|---|---|
| 1 | {riskLevel} | {sourceAgent} | {dimension} | {description} |

---

## 各角色评审意见

### {agentCode} ({agentName})
- 维度: {dimension}
- 风险等级: {riskLevel}
- 核心问题: {issue}
- 改进建议: {recommendation}
- 置信度: {confidenceScore}%

---

## 改进行动项

| # | 优先级 | 来源 | 标题 |
|---|---|---|---|
| 1 | {priority} | {sourceAgent} | {title} |

---

## 低置信度意见（需人工确认）

| # | 角色 | 意见 | 置信度 |
|---|---|---|---|
| 1 | {agentName} | {issue} | {confidenceScore}% |

---

> 本报告由 PrismReview 自动生成
```

---

## 4. 安全与脱敏

| 禁止导出 | 替代 |
|---|---|
| rawText 全文 | 不导出 |
| modelOutputRef 原始 JSON | 不导出 |
| API Key | 永不存在任何字段 |
| 用户 prompt / 文件内容 | 不导出 |

`providerSummary` 字段已脱敏：只包含计数，不含具体错误原因文本。

---

## 5. 状态机

```
仅 completed review 允许导出

allowedStatuses: ['completed']

draft / diagnosing / ready / running / interrupted / failed
  → 400: "Report export is only available for completed reviews. Current status: {status}"
```

`failed` review：当前不导出。后续可在 `getReport` 支持 failed review 后扩展。

---

## 6. 前端边界

| Sprint | 前端变更 |
|---|---|
| **6.0 (本 Sprint)** | **不改前端** |
| 6.1 (Backend) | 不改前端 |
| 6.2 (Frontend) | Report 页面新增 "导出 Markdown" 按钮 |

Sprint 6.2 的按钮行为：
- 调用 `GET /api/reviews/{id}/report/export.md` → 触发浏览器下载
- 仅在 `review.status === 'completed'` 且 `report.source !== undefined` 时启用
- 按钮文案："导出 Markdown"

---

## 7. 测试计划

| 测试 | 期望 |
|---|---|
| completed review (mock_fallback) | 200 + Content-Disposition + markdown body + objective + verdict 章节 |
| completed review (db_opinions) | 200 + providerSummary 信息在文件中 + verdict |
| verdict: approved | 评审结论显示 "通过" |
| verdict: conditionally_approved | 评审结论显示 "有条件通过" |
| verdict: rejected | 评审结论显示 "不通过" |
| verdict: missing/null | 评审结论显示 "未给出" |
| generatedAt | ISO 8601 格式，非固定值，不伪装为 report 原生字段 |
| ready review | 400 "available for completed reviews" |
| running review | 400 |
| draft review | 400 |
| invalid UUID | 400 |
| non-existent UUID | 404 |
| Content-Type verification | `text/markdown; charset=utf-8` |

---

## 8. 分 Sprint 计划

```
Sprint 6.0 — Contract（本 Sprint，只写文档）
Sprint 6.1 — Backend Export API
  - 新增 reviews/report/export 路由
  - Markdown template + service
  - 状态机守卫（仅 completed）
  - 安全脱敏
  - smoke 扩展
Sprint 6.2 — Frontend Button Enable
  - antigravity: Report 页新增 "导出 Markdown" 按钮
  - tsc 0 errors + 浏览器验证
Sprint 6.3 — Demo/Runbook Refresh
  - 更新 demo 文档
  - 更新 Demo Rehearsal Report
```
