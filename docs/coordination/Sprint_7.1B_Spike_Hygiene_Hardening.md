# Sprint 7.1B — Spike Hygiene Hardening

> 把 spike-provider-guard.js 的安全行为同步到所有 standalone spike 脚本。

---

## 1. 修改文件

| 文件 | 变更 |
|---|---|
| `scripts/spike-local-llm.js` | 默认不输出 raw/parsed response；DEBUG_PROVIDER_RAW=true 才打印；parse_error/invalid_schema exit(1) |
| `scripts/spike-agent-turn.js` | 默认不输出 AgentTurnResult JSON；DEBUG_PROVIDER_RAW=true 才打印；missing fields exit(1) |
| `scripts/spike-provider-guard.js` | 已在上一轮加固（不回退） |

## 2. 行为

| 场景 | 旧行为 | 新行为 |
|---|---|---|
| Mock provider 成功 | 输出完整 JSON | 仅摘要，无 raw |
| LM Studio 成功 | 输出完整 raw + parsed | DEBUG_PROVIDER_RAW=true 才输出 |
| parse_error | 打印 warning，exit 0 | exit 1，error 级别 |
| invalid_schema (缺字段) | 打印 warning，exit 0 | exit 1，error 级别 |

## 3. 验证

```
spike-provider-guard (mock):       无 raw dump ✅
spike-agent-turn (mock):           无 AgentTurnResult dump ✅
spike-local-llm (guard blocked):   无 raw response ✅
smoke-provider-robustness:        14/14 ✅
smoke-runtime:                    31/31 ✅
smoke-queue:                      15/15 ✅
```
