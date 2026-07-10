# Sprint 4.4A — Provider Adapter & Budget Guard Contract

> 设计未来如何安全接入 LM Studio 与 OpenAI-compatible 付费模型。
> 只写合同，不写代码。

---

## 1. Provider 类型

| Provider | 标识符 | 类型 | 环境依赖 | 默认？ |
|---|---|---|---|---|
| Mock | `mock` | 本地 | 无 | ✅ |
| LM Studio | `lmstudio` | 本地 | LM Studio 进程 | ❌ |
| OpenAI Compatible | `openai_compatible` | 外部 | API Key + URL | ❌ |

---

## 2. 环境变量合同

### 2.1 必选

| 变量 | 类型 | 说明 | 默认值 |
|---|---|---|---|
| `MODEL_PROVIDER` | `"mock" \| "lmstudio" \| "openai_compatible"` | 选择 provider | `"mock"` |
| `ALLOW_EXTERNAL_MODEL_CALLS` | `"true" \| ""` | 是否允许外部调用（生产安全闸） | `""`（禁止） |

### 2.2 可选（随 provider 变化）

| 变量 | provider | 说明 | 示例 |
|---|---|---|---|
| `MODEL_BASE_URL` | lmstudio / openai_compatible | Base URL | `http://127.0.0.1:1234/v1` |
| `MODEL_API_KEY` | openai_compatible | API Key | `sk-...`（禁止写代码/文档/日志） |
| `MODEL_NAME` | 所有 | 模型名称 | `google/gemma-4-12b` |
| `MODEL_TIMEOUT_MS` | 所有 | 超时时间（毫秒） | `120000` |
| `MODEL_MAX_TOKENS` | 所有 | 最大 token 数 | `2048` |
| `MODEL_BUDGET_LIMIT` | openai_compatible | 单次会话预算（美元） | `0.10` |
| `MODEL_DAILY_CALL_LIMIT` | openai_compatible | 每日最大调用次数 | `100` |

---

## 3. Guard 规则

### 3.1 启用矩阵

| MODEL_PROVIDER | ALLOW_EXTERNAL_MODEL_CALLS | MODEL_API_KEY | 结果 |
|---|---|---|---|
| 未设置 / `mock` | 任意 | 任意 | ✅ mock |
| `lmstudio` | `"true"` | 不需要 | ✅ lmstudio |
| `lmstudio` | 非 `"true"` | 任意 | ❌ GUARD: "Set ALLOW_EXTERNAL_MODEL_CALLS=true" |
| `openai_compatible` | `"true"` | 存在且非空 | ✅ openai_compatible |
| `openai_compatible` | `"true"` | 未设置 | ❌ GUARD: "MODEL_API_KEY required" |
| `openai_compatible` | 非 `"true"` | 任意 | ❌ GUARD: "ALLOW_EXTERNAL_MODEL_CALLS must be true for external providers" |
| 其他值 | 任意 | 任意 | ❌ GUARD: "Unsupported provider: {...}" |

### 3.2 API Key 安全

- **禁止写入代码**：API Key 只能在 `.env` 或环境变量中设置
- **禁止写入文档**：本文档示例使用 `sk-...` 占位符，不得替换为真实值
- **禁止写入日志**：`MODEL_API_KEY` 不得出现在任何日志、错误消息、HTTP 响应中
- **禁止写入 Git**：`.env` 文件已在 `.gitignore` 中

---

## 4. 预算保护

### 4.1 调用记录

每次外部模型调用记录：

```typescript
interface ModelCallRecord {
  timestamp: string;
  provider: string;
  model: string;
  tokens: { prompt: number; completion: number };
  durationMs: number;
  result: 'success' | 'timeout' | 'parse_error' | 'http_error';
  costEstimate?: number;  // 外部 provider 估算
}
```

记录方式：内存累计（进程重启丢失），日志输出（可追溯）。

### 4.2 Fail Closed 规则

| 触发条件 | 行为 |
|---|---|
| 超预算（`MODEL_BUDGET_LIMIT` 超出） | ❌ 拒绝调用，返回 mock |
| 超每日限制（`MODEL_DAILY_CALL_LIMIT` 超出） | ❌ 拒绝调用，返回 mock |
| 连续 5 次调用失败 | ❌ circuit breaker 打开，15 分钟内拒绝所有外部调用 |
| API Key 缺失 | ❌ 不调用，抛 GUARD 错误 |
| 超时 | ❌ `turn.timeout`，不 retry 外部 provider |

### 4.3 Circuit Breaker 设计

```
状态图:
  CLOSED ──5 次连续失败──→ OPEN
    │                        │
    │                   15 分钟后
    │                        │
    └──────────←─────────────┘
           HALF_OPEN
          (接受 1 次探测调用)
```

| 状态 | 行为 |
|---|---|
| CLOSED | 正常调用 |
| OPEN | 拒绝所有外部调用，返回 mock |
| HALF_OPEN | 允许 1 次探测调用；成功 → CLOSED；失败 → OPEN |

Circuit breaker 仅适用于 `openai_compatible` provider。`lmstudio` 不需要 circuit breaker（本地无成本）。

---

## 5. Fallback 策略

### 5.1 Fallback 决策矩阵

| 场景 | 是否 fallback mock | 理由 |
|---|---|---|
| provider 超时 | ✅ fallback | 不阻塞评审，标注 `turn.timeout` |
| provider HTTP 5xx | ✅ fallback | 服务异常，标注 `turn.failed` |
| provider JSON 解析失败 | ✅ fallback | 模型输出不可控，标注 `turn.failed` |
| Guard 拦截 | ❌ 不 fallback | 配置错误，必须显式修复 |
| Circuit breaker OPEN | ✅ fallback | 保护外部服务，标注来源 |
| 超预算 | ✅ fallback | 成本控制优先 |
| API Key 错误 401 | ❌ 不 fallback | 配置错误，必须修复 |
| 需要真实模型但未授权 | ❌ 不 fallback | 预期行为 |

### 5.2 Silent Fallback 禁止

所有 fallback 必须记录：
- 日志级别：`warn`
- 消息格式：`[Fallback] ${provider} → mock, reason: ${reason}`
- Report 标注：`source: 'mock_fallback'` + `generatedFromTurns: false`

**不允许**：无声地从 lmstudio/openai 降级到 mock 而没有任何日志或标记。

---

## 6. 输出 JSON 契约

### 6.1 必选字段

```typescript
interface AgentTurnResult {
  roleCode: string;
  dimension: string;
  riskLevel: 'high' | 'medium' | 'low' | 'info';
  issue: string;
  recommendation: string;
  confidenceScore: number;  // 0-100
  rawText: string;          // 模型原始输出（用于调试/审计）
}
```

### 6.2 ParseError 处理

| 模型输出 | 处理 |
|---|---|
| 有效 JSON 对象 | 直接使用 |
| 有效 JSON 数组 | 取 `[0]` |
| Markdown 包裹（\`\`\`json） | 剥离后解析 |
| 非 JSON 字符串 | `parseError` + fallback |
| 空字符串 | `parseError` + fallback |
| 字段缺失 | `confidenceScore` 默认 50，其余字段标记 `"(missing)"` |

### 6.3 Provider 输出统一

所有 provider（mock / lmstudio / openai_compatible）必须输出相同结构的 `AgentTurnResult`。

---

## 7. 模型建议

### 7.1 候选模型

| 模型 | 类型 | 单次延迟 | 成本 | 中文质量 | 综合评分 |
|---|---|---|---|---|---|
| **LM Studio Gemma-4-12b** | 本地 | 30-40s | 0 | ⭐⭐⭐ | 3.5/5 |
| **Kimi-K2.6** | 外部 API | 3-8s | ~$0.01/次 | ⭐⭐⭐⭐ | 4.0/5 |
| **GLM-5.2** | 外部 API | 2-6s | ~$0.005/次 | ⭐⭐⭐⭐⭐ | 4.2/5 |
| **DeepSeek-V4-Flash** | 外部 API | 1-3s | ~$0.003/次 | ⭐⭐⭐⭐ | 4.5/5 |

### 7.2 推荐顺序

```
1. LM Studio Gemma-4-12b   → 开发阶段首选（零成本、离线可用）
2. DeepSeek-V4-Flash       → 外部接入首选（低延迟、低成本、高质量）
3. GLM-5.2                 → 中文方案评审场景首选（中文输出最优）
4. Kimi-K2.6               → 备选（综合能力强，成本稍高）
```

### 7.3 选择理由

- **开发阶段**：LM Studio（零成本、无网络依赖、安全）
- **Demo 展示**：DeepSeek-V4-Flash（1-3s，体验流畅）
- **中文方案评审**：GLM-5.2（中文输出质量最高）
- **预算优先**：DeepSeek-V4-Flash（$0.003/次，最便宜）

---

## 8. Sprint 4.4B 实现边界

如果进入 Sprint 4.4B 实现，**只允许**：

```
✅ provider-adapter.js 扩展（openai_compatible）
✅ scripts/spike-agent-turn.js 测试
✅ 预算记录（内存 + 日志）
✅ circuit breaker（内存状态）
✅ 不接 queue 主链路
✅ 不接 Meeting SSE
✅ 不改前端
✅ mock 默认
✅ LM Studio 需显式开启
✅ OpenAI Compatible 需 API Key + ALLOW_EXTERNAL_MODEL_CALLS

❌ 不接真实 LLM 到主链路
❌ 不提交 API Key
❌ 不接 RAG/Embedding/MinIO
```

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| API Key 泄露 | `.env` 不进 Git，日志不打印 Key |
| 预算超支 | Circuit breaker + 每日限制 + 预算上限 |
| Silent fallback | 所有 fallback 需 warn 日志 |
| 模型输出不稳定 | `parseError` 处理 + markdown 剥离 |
