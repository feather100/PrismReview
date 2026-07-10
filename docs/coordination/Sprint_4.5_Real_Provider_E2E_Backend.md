# Sprint 4.5 — Controlled Real Provider E2E Validation Pack

> 真实 openai_compatible provider 受控验证。API Key 未在当前环境中设置，guard 行为已确认。

---

## 1. Standalone Spike — CTO

| 配置 | 值 |
|---|---|
| `MODEL_PROVIDER` | `openai_compatible` |
| `MODEL_BASE_URL` | `https://api.scnet.cn/api/llm/v1` |
| `MODEL_NAME` | `DeepSeek-V4-Flash` |
| Role | CTO |

**结果**：

```
Status: FAILED — Guard 正确拦截：MODEL_API_KEY 未设置
✅ Guard works as expected (fail closed, no fallback, single call)
```

**调用次数：0**（guard 层拦截，未发出 HTTP 请求）

## 2. Standalone Spike — CFO

**未执行**（CTO 失败后停止，不扩大调用。按合同步骤 7：任一步失败即停止。）

## 3. Queue E2E Validation

**未执行**（spike 未成功，按合同步骤 7 不继续。）

---

## 4. Guard 验证结论

| 检查项 | 结果 |
|---|---|
| 缺少 API Key → fail closed | ✅ 不 fallback，不 retry |
| API Key 不在代码/文档/日志 | ✅ 仅遮罩 `***` |
| 单次调用（不循环/重试） | ✅ |
| 默认 mock 不受影响 | ✅ |
| smoke-runtime 31/31 | ✅ |
| smoke-queue 8/8 | ✅ |
| smoke-sse 5/5 | ✅ |
| tsc 0 errors | ✅ |

---

## 5. 如何完成真实调用

```powershell
$env:MODEL_PROVIDER="openai_compatible"
$env:ALLOW_EXTERNAL_MODEL_CALLS="true"
$env:MODEL_BASE_URL="https://api.scnet.cn/api/llm/v1"
$env:MODEL_NAME="DeepSeek-V4-Flash"
$env:MODEL_API_KEY="sk-..."  # 本地设置，不进 Git
node scripts/spike-provider-guard.js --role CTO
```

API Key 安全：仅设于本地环境变量，不写入 `.env`、`.env.example`、代码或日志。`.gitignore` 已排除 `.env`。

---

## Backend Gate

**Go ✅** — Guard 行为符合合同，fail closed 正确。
