# Sprint 5.2 — Report API Provider Summary

> 在 Report API 中暴露最小 provider 可观测性摘要。

---

## 1. 新增字段

```typescript
providerSummary: {
  totalTurns: number;
  bySource: {
    mock?: number; lmstudio?: number; openai_compatible?: number; fallback_mock?: number; failed?: number;
  };
  fallbackCount: number;
  failedCount: number;
  models: string[];
  hasRealProvider: boolean;
}
```

## 2. 数据来源

从 `review_opinions.modelOutputRef` JSON 聚合。JSON parse 失败不计入 total，不计 500，仅记 warn 日志。

| 路径 | providerSummary |
|---|---|
| DB opinions 存在 | 聚合所有 opinion 的 modelOutputRef JSON |
| mock fallback | `totalTurns: 0, bySource: { mock: N }` |

## 3. 修改文件

| 文件 | 变更 |
|---|---|
| `report-response.dto.ts` | 新增 `providerSummary` optional 字段 |
| `reviews.service.ts` | `buildProviderSummary` helper + 两路径填充 + Logger |

## 4. 验证

```
smoke-runtime: 31/31 ✅
smoke-queue:   15/15 ✅
smoke-sse:      5/5  ✅
tsc:            0 errors ✅
```
