# Sprint 4.4B — Provider Guard Standalone Spike

> 实现 mock / lmstudio / openai_compatible 三种 provider guard 的独立验证。

---

## 1. 修改文件

| 文件 | 变更 |
|---|---|
| `scripts/provider-adapter.js` | 全面重写：新增 openai_compatible provider, 预算保护, circuit breaker, 环境变量统一 |
| `scripts/spike-provider-guard.js` | 新增 standalone spike 脚本 |

---

## 2. Provider 矩阵

| Provider | guard 条件 |
|---|---|
| `mock` | 默认（零依赖） |
| `lmstudio` | `ALLOW_EXTERNAL_MODEL_CALLS=true` |
| `openai_compatible` | `ALLOW_EXTERNAL_MODEL_CALLS=true` + `MODEL_API_KEY` |
| 未知 | 抛 Unsupported provider |

## 3. 环境变量

| 变量 | 说明 |
|---|---|
| `MODEL_PROVIDER` | `mock`, `lmstudio`, `openai_compatible` |
| `ALLOW_EXTERNAL_MODEL_CALLS` | `"true"` 启用 |
| `MODEL_BASE_URL` | Base URL（兼容 LMSTUDIO_BASE_URL） |
| `MODEL_NAME` | 模型名称（兼容 LMSTUDIO_MODEL） |
| `MODEL_API_KEY` | API Key（禁止日志输出） |
| `MODEL_TIMEOUT_MS` | 超时（默认 120000） |
| `MODEL_MAX_TOKENS` | max_tokens（默认 2048） |
| `MODEL_BUDGET_LIMIT` | 单次会话预算 $0.10 |
| `MODEL_DAILY_CALL_LIMIT` | 每日调用限制 100 |

## 4. 预算保护

- Circuit breaker：5 次连续失败 → 15 分钟断开
- 每日调用限制：`MODEL_DAILY_CALL_LIMIT`
- 总预算限制：`MODEL_BUDGET_LIMIT`
- 每次调用记录 tokens/duration/cost（内存累计，进程重启丢失）

## 5. 验证结果

### Guard rules

| 测试 | 结果 |
|---|---|
| 默认 → mock | ✅ 1ms |
| lmstudio no allow → GUARD | ✅ |
| openai_compatible no allow → GUARD | ✅ |
| openai_compatible no key → GUARD | ✅ |
| lmstudio + allow → LM Studio | ✅ 45s, medium, Architecture, 90 confidence |

### Smoke

```
smoke-runtime: 31/31 ✅
smoke-sse:     5/5  ✅
tsc:           0 errors ✅
```

---

## Backend Gate

**Go ✅** — 三种 provider guard 验证通过，主链路无回归。
