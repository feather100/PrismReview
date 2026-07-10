# Sprint 1.7 — Local LLM Spike

> 隔离验证 LM Studio OpenAI-compatible API 可调用。
> 不接入主业务链路（Review / Meeting / Report）。

---

## 1. 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MODEL_PROVIDER` | — | 设为 `lmstudio` 启用 |
| `ALLOW_EXTERNAL_MODEL_CALLS` | — | 设为 `true` 放行 |
| `LMSTUDIO_BASE_URL` | `http://10.0.45.168:1234/v1` | LM Studio API 地址 |
| `LMSTUDIO_MODEL` | `google/gemma-4-12b` | 模型名称 |

### LM Studio 要求

- 启动 LM Studio 本地服务器（Local Inference Server）
- 加载模型 `google/gemma-4-12b`（或兼容模型）
- 确认 API 可访问：`curl http://10.0.45.168:1234/v1/models`

---

## 2. 运行

### Guard 拦截（默认行为）

```bash
node scripts/spike-local-llm.js
```

输出：

```
🔒 MODEL PROVIDER GUARD

  MODEL_PROVIDER=(not set)
  ALLOW_EXTERNAL_MODEL_CALLS=(not set)

  Set both to enable LM Studio call:
    export MODEL_PROVIDER=lmstudio
    export ALLOW_EXTERNAL_MODEL_CALLS=true

  This guard prevents accidental external model calls.
  LM Studio is a LOCAL provider — do NOT use with real production documents.
```

### 真实调用

```bash
# Windows (PowerShell)
$env:MODEL_PROVIDER="lmstudio"
$env:ALLOW_EXTERNAL_MODEL_CALLS="true"
node scripts/spike-local-llm.js

# Linux / macOS / WSL
MODEL_PROVIDER=lmstudio ALLOW_EXTERNAL_MODEL_CALLS=true \
  node scripts/spike-local-llm.js
```

---

## 3. 成功样例

```
🔬 Local LLM Spike — LM Studio
   Base: http://10.0.45.168:1234/v1
   Model: google/gemma-4-12b
   Timeout: 30000ms

⏱  Response received in 4231ms

=== Raw Response ===
{
  "riskLevel": "high",
  "dimension": "架构风险",
  "issue": "同步调用链路放大尾延迟，核心路径无熔断机制",
  "recommendation": "将非关键路径改为异步事件驱动，设置超时和熔断",
  "confidenceScore": 78
}
====================

=== Parsed JSON ===
{
  "riskLevel": "high",
  "dimension": "架构风险",
  "issue": "同步调用链路放大尾延迟，核心路径无熔断机制",
  "recommendation": "将非关键路径改为异步事件驱动，设置超时和熔断",
  "confidenceScore": 78
}
===================

✅ All required fields present

Tokens: {"prompt_tokens":145,"completion_tokens":89,"total_tokens":234}
```

---

## 4. 失败场景

| 场景 | 输出 |
|---|---|
| LM Studio 未启动 | `❌ Request failed: connect ECONNREFUSED 10.0.45.168:1234` |
| 模型未加载 | `❌ HTTP 400 — model not loaded` |
| 超时（30s） | `❌ Request timed out after 30000ms` |
| JSON 格式错误 | `⚠️  Could not parse response as JSON` |
| 字段缺失 | `⚠️  Missing fields: confidenceScore` |

---

## 5. Prompt 模板

当前 spike 使用固定 prompt，不做模板化/版本化。

**System prompt**:
```
You are a technical reviewer (CTO). Review the provided proposal and output a
structured JSON assessment. Always respond with valid JSON only, no markdown,
no explanation outside the JSON.

JSON schema: { riskLevel, dimension, issue, recommendation, confidenceScore }
```

**User prompt**: 硬编码方案描述（微服务迁移 + Kafka + Saga + CQRS）。

---

## 6. 风险

| 风险 | 说明 |
|---|---|
| **输出不稳定** | 同一 prompt 每次输出可能不同，JSON 格式偶发错误 |
| **JSON 需校验** | 模型偶尔输出 markdown 包裹（\`\`\`json），spike 脚本已处理 |
| **延迟不可控** | 本地模型 1–10s，取决于硬件和模型大小 |
| **不可用于生产** | LM Studio 是本地开发工具，不可用于生产环境的数据处理 |
| **不写 DB** | 本 spike 不写入任何表 |

---

## 7. 禁止事项

- 不替换 `meeting/stream` SSE
- 不写 `review_turns` / `review_opinions`
- 不让前端调用 LLM
- 不接 RAG / Embedding / MinIO
- 不改 Prisma schema
