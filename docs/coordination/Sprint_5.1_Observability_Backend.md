# Sprint 5.1 — Agent Output Observability Backend Minimal

> 按 Sprint 5.0 合同，实现最小后端可观测性落库。

---

## 1. 修改文件

| 文件 | 变更 |
|---|---|
| `apps/api/src/modules/reviews/queue/queue.service.ts` | 重写 `executeAgentTurn`：填充 `modelOutputRef` JSON + `reasoningSummary` |
| `scripts/smoke-queue.js` | 新增 `modelOutputRef parseable` 测试 |

## 2. modelOutputRef JSON 结构

```typescript
interface ModelOutputRef {
  providerSource: 'mock' | 'lmstudio' | 'openai_compatible' | 'fallback_mock' | 'failed';
  providerName: string;
  modelName: string;
  fallback: boolean;
  fallbackReason?: string;
  errorReason?: string;
  durationMs: number;
  tokens?: { prompt: number; completion: number };
}
```

## 3. 各路径填充

| 路径 | providerSource | fallback | errorReason | reasoningSummary |
|---|---|---|---|---|
| mock 成功 | `mock` | false | — | `src=mock | mock` |
| lmstudio 成功 | `lmstudio` | false | — | `src=lmstudio | google/gemma-4-12b` |
| openai_compatible 成功 | `openai_compatible` | false | — | `src=openai_compatible | DeepSeek-V4-Flash` |
| Runtime error → mock | `fallback_mock` | true | ✅ | `src=fallback_mock | ... fallback: ...` |
| 401/403 | `failed` | false | ✅ (sanitized) | `Auth error (no fallback): ...` |
| Guard error | `failed` | false | ✅ | `Guard error: ...` |

## 4. reasoningSummary

- 不包含 API Key（Bearer token 已脱敏）
- 不包含完整 prompt/rawText
- 最大 200 字符
- 格式：`src={providerSource} | {modelName}[ | fallback/err: {reason}]`

## 5. 验证

```
smoke-runtime:              31/31 ✅
smoke-queue (15, +1 parse): 15/15 ✅
smoke-sse:                   5/5  ✅
smoke-provider-robustness:  14/14 ✅
tsc:                         0 errors ✅
```

---

## Backend Gate

**Go ✅** — modelOutputRef JSON 标准化，5 种 providerSource 区分，reasoningSummary 脱敏，不改 schema。
