# Sprint 4.4D — Provider Safety Hardening

> 修复 openai_compatible 401/403 fallback、guard 错误 retry、.env.example 清理。

---

## 1. 修改文件

| 文件 | 变更 |
|---|---|
| `apps/api/src/modules/reviews/queue/queue.service.ts` | NO_RETRY 机制：guard/auth 错误不 retry、401/403 不 fallback、Guard error 不 retry |
| `.env.example` | 更新为 Sprint 4.4 合同变量 |

## 2. 修复项

### 2.1 401/403 不再 fallback mock

之前：所有 provider.run() 错误都 fallback mock（包括 401/403）。
现在：401/403 → fail closed，标记 `turn.failed`，不 fallback，不 retry。

```typescript
if (err.message.includes('HTTP 401') || err.message.includes('HTTP 403')) {
  this.logger.error(`Auth error (no fallback): ${sanitized}`);
  // Mark turn as failed, no fallback, no retry
  throw new Error('NO_RETRY:' + err.message);
}
```

### 2.2 Guard error 不再 3 次 retry

之前：`getProvider()` guard 错误 → throw → queue retry 3 次 → 最终失败。
现在：Guard error → 标记 `turn.failed` → throw `NO_RETRY:` → queue 跳过 retry → 立即失败。

### 2.3 .env.example 更新

- 增加 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_TIMEOUT_MS`、`MODEL_MAX_TOKENS`
- 增加 `MODEL_BUDGET_LIMIT`、`MODEL_DAILY_CALL_LIMIT`
- 清理 `ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL`（已废弃）
- 清理旧 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`（统一为 `MODEL_API_KEY`）

### 2.4 NO_RETRY 机制

```typescript
// processNext() catch block:
if (err.message.startsWith('NO_RETRY:')) {
  job.status = 'failed';  // 不重试
} else {
  job.retries++;
  if (job.retries <= MAX_RETRIES) { job.status = 'queued'; } // 正常重试
}
```

## 3. 验证

```
smoke-runtime: 31/31 ✅
smoke-queue:    8/8  ✅
smoke-sse:      5/5  ✅
tsc:            0 errors ✅
```

---

## Backend Gate

**Go ✅** — 401/403 fail closed，guard 错误不 retry，env.example 已更新。
