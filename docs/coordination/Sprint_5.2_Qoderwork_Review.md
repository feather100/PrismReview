# Sprint 5.2 Report Provider Summary — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：快速 Gate（只查 P0/P1，证据 ≤ 5 条）  
> 审查对象：`docs/coordination/Sprint_5.2_Report_Provider_Summary_Backend.md`  
> 交叉验证：`reviews.service.ts`（552 行）、`report-response.dto.ts`（74 行）、`queue.service.ts`（365 行）、`smoke-runtime.js`（322 行）、`schema.prisma`、`reviews.gateway.ts`、前端文件

---

## Gate: **Go** ✅

无 P0 / P1 阻塞项。Report API 新增 optional `providerSummary` 字段，向后兼容，7 项检查全部通过。

---

## 证据（5 条）

### 证据 1 — optional providerSummary，向后兼容 + 仅读 DB 不调模型 ✅

`report-response.dto.ts:46`：
```typescript
@Expose() providerSummary?: { totalTurns, bySource, fallbackCount, failedCount, models, hasRealProvider };
```
Optional 字段（`?`），现有消费者不受影响。✅

`reviews.service.ts:412-444` — `buildProviderSummary()` 仅遍历已入库的 `dbOpinions[].modelOutputRef`，执行 `JSON.parse`，不调用任何外部模型。两路径覆盖：

| 路径 | providerSummary 来源 | 代码行 |
|------|---------------------|--------|
| DB opinions | `buildProviderSummary(dbOpinions)` 聚合 | 404 |
| Mock fallback | 硬编码 `{ totalTurns: 0, bySource: { mock: N }, fallbackCount: 0, failedCount: 0 }` | 347 |

### 证据 2 — JSON parse 失败不导致 500 + 五态区分完整 ✅

`reviews.service.ts:419-425` — try/catch 包裹 `JSON.parse`：
```typescript
try {
  if (o.modelOutputRef) ref = JSON.parse(o.modelOutputRef);
} catch (e: any) {
  this.logger.warn(`modelOutputRef parse error: ${e.message}`);
}
const source = ref?.providerSource || 'mock';
```
Parse 失败 → `ref = null` → 默认 `'mock'`，不抛异常、不计入 failed、仅 warn 日志。Report API 返回 200。✅

五态区分（`buildProviderSummary` lines 425-432）：

| 字段 | 来源 | 值域 |
|------|------|------|
| `bySource[source]++` | `ref?.providerSource \|\| 'mock'` | mock / lmstudio / openai_compatible / fallback_mock / failed |
| `fallbackCount` | `ref?.fallback === true` | 计数 |
| `failedCount` | `source === 'failed'` | 计数 |
| `models[]` | `ref?.modelName` | 去重数组 |
| `hasRealProvider` | `bySource` 含 lmstudio 或 openai_compatible | boolean |

### 证据 3 — 零 API Key / prompt / rawText 泄漏 ✅

`buildProviderSummary` 仅提取三个安全字段：

| 提取字段 | 用途 | 敏感性 |
|---------|------|--------|
| `ref?.providerSource` | provider 类型统计 | 无敏感 |
| `ref?.fallback` | fallback 计数 | 无敏感 |
| `ref?.modelName` | 模型名称 | 无敏感 |

不提取 `ref?.sanitizedChunk`、`ref?.errorReason`、`ref?.fallbackReason` 等可能含敏感信息的字段。不输出任何原始模型输出。✅

warn 日志（line 423）仅记录 `e.message`（JSON parse 错误描述），不含 modelOutputRef 原文。✅

### 证据 4 — 零 schema/前端/SSE 改动 ✅

| 文件 | 状态 | 验证 |
|------|------|------|
| `schema.prisma` | 未改 | ✅ 复用已有 `modelOutputRef` String? |
| `reviews.gateway.ts` | 252 行，未改 | ✅ SSE 零改动 |
| `reviews.controller.ts` | 131 行，未改 | ✅ |
| `queue.service.ts` | 365 行，未改 | ✅ |
| `provider-adapter.js` | 232 行，未改 | ✅ |
| 前端文件 | 未改 | ✅ |

仅改两个文件：`report-response.dto.ts`（+10 行 optional 字段）和 `reviews.service.ts`（+`buildProviderSummary` 方法 + 两路径填充）。

### 证据 5 — smoke 覆盖 + 无回归 ✅

| 测试套件 | 结果 | 覆盖 |
|---------|------|------|
| smoke-runtime | 31/31 ✅ | mock fallback 路径（source=mock_fallback）+ DB opinions 路径 |
| smoke-queue | 15/15 ✅ | DB opinions + modelOutputRef parseable |
| smoke-sse | 5/5 ✅ | SSE 零影响 |
| smoke-provider-robustness | 14/14 ✅ | parser 无回归 |
| tsc | 0 errors ✅ | 类型安全 |

smoke-runtime test 16 验证 Report 响应结构（`source` + `verdict` + `risks[]` + `opinions[]` + `actionItems[]`），新字段 `providerSummary` 为 optional，不破坏现有断言。✅

异常 `modelOutputRef`（非 JSON）的防御性处理通过代码审查确认正确（try/catch + warn + 默认 mock），smoke 层未单独覆盖此边界场景。

---

## P0 阻塞项

无。

## P1 建议项

无。

## P2 可延后项

| # | 描述 | 说明 |
|---|------|------|
| P2-1 | smoke 未单独覆盖异常 modelOutputRef（非 JSON / 空字符串） | 代码 try/catch 正确，但无自动化验证 |
| P2-2 | mock fallback 路径的 `providerSummary` 为硬编码结构，与 DB 路径结构略有差异 | `totalTurns: 0` vs DB 路径 `totalTurns: N`，语义一致 |
| P2-3 | ACTIVE_SPRINT.md 仍显示 Sprint 4.7 | 应在 5.3 前同步 |

---

## 变更统计

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `report-response.dto.ts` | 修改 | 64 → 74 行（+10），新增 `providerSummary?` optional 字段 |
| `reviews.service.ts` | 修改 | 新增 `buildProviderSummary` 方法（33 行）+ 两路径填充 |

**零 schema / 前端 / SSE / queue / provider-adapter 变更。**
