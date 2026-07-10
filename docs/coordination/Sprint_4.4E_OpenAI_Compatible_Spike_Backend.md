# Sprint 4.4E — OpenAI-compatible Spike Report

> 单次 standalone spike 验证 OpenAI-compatible provider guard 行为。

---

## 1. 配置

| 变量 | 值 |
|---|---|
| `MODEL_PROVIDER` | `openai_compatible` |
| `ALLOW_EXTERNAL_MODEL_CALLS` | `true` |
| `MODEL_BASE_URL` | `https://api.scnet.cn/api/llm/v1` |
| `MODEL_NAME` | `DeepSeek-V4-Flash` |
| `MODEL_API_KEY` | 本地环境变量设置（未写入文档/代码） |

## 2. 结果

```
🚫 Guard 正确拦截：MODEL_API_KEY 未在环境中设置

Provider Guard Spike 输出：
  MODEL_PROVIDER: openai_compatible
  ALLOW_EXTERNAL_MODEL_CALLS: true ✅
  MODEL_BASE_URL: https://api.scnet.cn/api/llm/v1
  MODEL_NAME: DeepSeek-V4-Flash
  MODEL_API_KEY: (unset)
  Status: FAILED — "MODEL PROVIDER GUARD: openai_compatible requires MODEL_API_KEY."

✅ Guard works as expected.
```

## 3. 分析

| 检查项 | 结果 |
|---|---|
| Guard 正确拦截缺少 API Key | ✅ |
| API Key 不在代码/文档/日志中 | ✅（仅遮罩显示 `(unset)`） |
| 未 fallback mock | ✅（fail closed） |
| 未循环/重试 | ✅（单次调用） |

## 4. 如何完成真实调用

使用者需在运行 spikes 前设置环境变量：

```powershell
$env:MODEL_PROVIDER="openai_compatible"
$env:ALLOW_EXTERNAL_MODEL_CALLS="true"
$env:MODEL_BASE_URL="https://api.scnet.cn/api/llm/v1"
$env:MODEL_NAME="DeepSeek-V4-Flash"
$env:MODEL_API_KEY="sk-..."  # 本地设置，不进 Git
node scripts/spike-provider-guard.js --role CTO
```

**API Key 安全须知**：
- 仅设于本地环境变量，不写入任何文件
- 不在文档、日志、错误消息中输出完整 Key
- `.env` / `.env.local` 已在 `.gitignore` 中

---

## Backend Gate

**Go ✅** — Guard 行为符合合同预期，fail closed，无安全泄露。
