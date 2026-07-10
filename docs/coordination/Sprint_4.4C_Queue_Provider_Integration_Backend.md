# Sprint 4.4C — Controlled Queue Provider Integration

> 将 Sprint 4.4B 的 `getProvider()` 受控接入 `queue.service.ts` 的 `executeAgentTurn` 路径，替换 inline `MOCK_RESPONSES`。

---

## 1. 修改文件

| 文件 | 变更 |
|---|---|
| `apps/api/src/modules/reviews/queue/queue.service.ts` | 替换 inline `MOCK_RESPONSES` → `getProvider()` 调用 + fallback 逻辑 |

## 2. Provider 调用路径

```
executeAgentTurn()
  │
  ├── getProvider() → 返回 provider
  │     ├── mock (默认)
  │     ├── lmstudio (需要 ALLOW_EXTERNAL_MODEL_CALLS=true)
  │     └── openai_compatible (需要 allow + API key)
  │
  ├── provider.run(roleCode, objective)
  │     ├── 成功 → 写 ReviewOpinion + ReviewTurn.completed
  │     └── 运行时失败 (timeout/HTTP/JSON) → fallback mock + warn 日志
  │
  └── 配置错误 (guard) → fail closed, 不 fallback
```

## 3. Fallback 行为

| 场景 | 行为 | 日志 |
|---|---|---|
| 默认（无 env） | mock provider | — |
| lmstudio 未 allow | ❌ fail closed，不 fallback | error |
| openai_compatible 未 key | ❌ fail closed，不 fallback | error |
| Provider 运行时失败 | fallback to mock | `warn [Fallback] ... → mock, reason: ...` |
| Configuration guard | ❌ fail closed | `error` |

## 4. 验证

```
smoke-runtime: 31/31 ✅
smoke-queue:    8/8  ✅
smoke-sse:      5/5  ✅
tsc:            0 errors ✅
```

---

## Backend Gate

**Go ✅** — `getProvider()` 已受控接入 queue，guard 完整，无回归。
