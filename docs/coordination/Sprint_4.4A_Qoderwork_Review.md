# Sprint 4.4A Provider Guard Contract — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  
> 审查对象：`docs/coordination/Sprint_4.4A_Provider_Guard_Contract.md`  
> 交叉验证：`scripts/provider-adapter.js`、`apps/api/src/modules/reviews/queue/queue.service.ts`、`.env.example`、`.gitignore`

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 4.4A Provider Guard Contract 设计完整，八大复审重点全部通过。合同以 `MODEL_PROVIDER="mock"` 为默认值，`ALLOW_EXTERNAL_MODEL_CALLS` 双闸机制（环境变量 + API Key）有效防止误触外部调用，API Key 四禁规则清晰，预算保护（per-session + daily + circuit breaker）三层兜底，fallback 策略区分运行时错误（降级 mock）与配置错误（拒绝执行），Silent Fallback 禁止规则确保可观测性。Sprint 4.4B 实现边界明确隔离（不接主链路、不改前端、不改 schema），可以进入 standalone spike 阶段。

---

## 1. 是否默认 mock

**结论：✅ 默认 mock。**

合同 Section 2.1：

```
MODEL_PROVIDER: "mock" | "lmstudio" | "openai_compatible"  默认值: "mock"
```

Section 3.1 Guard 矩阵第一行：

```
MODEL_PROVIDER 未设置 / "mock" → 任意 ALLOW_EXTERNAL_MODEL_CALLS → 任意 MODEL_API_KEY → ✅ mock
```

与现有代码一致：`provider-adapter.js:143`

```javascript
if (!provider || provider === 'mock') {
  return { name: 'mock', run: mockProvider };
}
```

`.env.example` 当前值：`MODEL_PROVIDER="mock"` ✅  
`apps/api/.env` 当前值：`MODEL_PROVIDER="mock"` ✅  
queue.service.ts 内置 MOCK_RESPONSES，零 env 依赖 ✅

**无需改动即可保持默认 mock 行为。**

---

## 2. 是否禁止默认外部调用

**结论：✅ 双闸机制有效禁止。**

### 2.1 ALLOW_EXTERNAL_MODEL_CALLS 闸

合同 Section 2.1 设计：

```
ALLOW_EXTERNAL_MODEL_CALLS: "true" | ""  默认值: ""（禁止）
```

Guard 矩阵中，`lmstudio` 和 `openai_compatible` 均要求 `ALLOW_EXTERNAL_MODEL_CALLS="true"`，否则触发 GUARD 错误。

现有 `.env.example`：`ALLOW_EXTERNAL_MODEL_CALLS=false` ✅  
现有代码：`provider-adapter.js:148` — `if (allow !== 'true') throw ...` ✅

### 2.2 API Key 闸（openai_compatible 专用）

合同 Section 3.1 Guard 矩阵：

```
openai_compatible + ALLOW_EXTERNAL_MODEL_CALLS="true" + MODEL_API_KEY 未设置 → ❌ GUARD
openai_compatible + ALLOW_EXTERNAL_MODEL_CALLS="true" + MODEL_API_KEY 存在 → ✅
```

两道闸门必须同时打开才能调用外部 API。任何一道缺失都有明确的错误提示。

### 2.3 禁止矩阵

| 场景 | 是否阻止 | 机制 |
|------|---------|------|
| 未设置任何 env | ✅ | MODEL_PROVIDER 默认 mock |
| 设了 lmstudio 但没开 ALLOW | ✅ | GUARD 错误 |
| 设了 openai 但没开 ALLOW | ✅ | GUARD 错误 |
| 开了 ALLOW 但没给 API Key | ✅ | GUARD 错误 |
| 设了不认识的 provider | ✅ | "Unsupported provider" 错误 |
| 全部正确配置 | ✅ 放行 | 预期行为 |

**六个场景全覆盖，无遗漏。**

---

## 3. API Key 是否不落代码/日志/文档

**结论：✅ 四禁规则完整。**

合同 Section 3.2 明确四条红线：

| 禁令 | 合同描述 | 验证 |
|------|---------|------|
| 禁止写入代码 | API Key 只能在 `.env` 或环境变量中设置 | ✅ 现有 `provider-adapter.js` 无 API Key 引用 |
| 禁止写入文档 | 文档示例使用 `sk-...` 占位符 | ✅ `.env.example:23-24` 使用 `# OPENAI_API_KEY="sk-..."` |
| 禁止写入日志 | MODEL_API_KEY 不得出现在任何日志、错误消息、HTTP 响应中 | ✅ 合同显式规定 |
| 禁止写入 Git | `.env` 已在 `.gitignore` 中 | ✅ `.gitignore:12-14` 覆盖 `.env` / `.env.local` / `.env.*.local` |

### 3.1 .gitignore 覆盖验证

```gitignore
# Env
.env
.env.local
.env.*.local
```

`.env` 规则匹配任意深度的 `.env` 文件（包括 `apps/api/.env`）。✅

### 3.2 现有代码无 API Key 泄露

| 文件 | API Key 引用 | 状态 |
|------|-------------|------|
| `provider-adapter.js` | 无 | ✅ |
| `queue.service.ts` | 无 | ✅ |
| `.env.example` | `# OPENAI_API_KEY="sk-..."` — 注释 + 占位符 | ✅ |
| `.env` (apps/api/) | 同上 | ✅ |
| `spike-local-llm.js` | 无 | ✅ |
| `spike-agent-turn.js` | 无 | ✅ |

**零真实 API Key 存在于代码库中。**

### 3.3 合同对日志的约束

合同 Section 3.2："禁止写入日志 — MODEL_API_KEY 不得出现在任何日志、错误消息、HTTP 响应中"。这条规则需要在 4.4B 实现时确保 `getProvider()` 的错误消息不包含 Key 值，且 HTTP client 不打印 request headers。

---

## 4. 是否有预算上限

**结论：✅ 三层预算保护。**

### 4.1 Per-session 预算

合同 Section 2.2：`MODEL_BUDGET_LIMIT`（默认 `$0.10`）  
合同 Section 4.2："超预算（MODEL_BUDGET_LIMIT 超出）→ 拒绝调用，返回 mock"

### 4.2 每日调用限制

合同 Section 2.2：`MODEL_DAILY_CALL_LIMIT`（默认 `100`）  
合同 Section 4.2："超每日限制（MODEL_DAILY_CALL_LIMIT 超出）→ 拒绝调用，返回 mock"

### 4.3 Circuit Breaker

合同 Section 4.3：

```
CLOSED → 5 次连续失败 → OPEN（15 分钟拒绝） → HALF_OPEN（1 次探测）→ CLOSED / OPEN
```

### 4.4 调用记录

合同 Section 4.1 定义了 `ModelCallRecord`：

```typescript
interface ModelCallRecord {
  timestamp: string;
  provider: string;
  model: string;
  tokens: { prompt: number; completion: number };
  durationMs: number;
  result: 'success' | 'timeout' | 'parse_error' | 'http_error';
  costEstimate?: number;
}
```

记录方式："内存累计（进程重启丢失），日志输出（可追溯）"。

### 4.5 适用范围

| 保护层 | mock | lmstudio | openai_compatible |
|--------|------|----------|-------------------|
| Per-session 预算 | — | — | ✅ |
| 每日调用限制 | — | — | ✅ |
| Circuit breaker | — | — | ✅ |
| 调用记录 | — | — | ✅ |

合同 Section 4.3 末尾显式说明："Circuit breaker 仅适用于 `openai_compatible` provider。`lmstudio` 不需要 circuit breaker（本地无成本）。"✅

**三层保护仅作用于付费外部调用，本地 provider 不受限，设计合理。**

---

## 5. 是否有 timeout / retry / circuit breaker

**结论：✅ 三者均有明确设计。**

### 5.1 Timeout

合同 Section 2.2：`MODEL_TIMEOUT_MS`（默认 `120000` = 120s）  
合同 Section 4.2："超时 → turn.timeout，不 retry 外部 provider"

与现有代码一致：`provider-adapter.js:39` — `TIMEOUT_MS = 120000`。  
与 SSE 超时体系兼容：SSE no-progress timeout = 120s，overall = 300s。模型 120s 超时 < SSE 300s 总超时。

### 5.2 No Retry

合同 Section 4.2："超时 → turn.timeout，不 retry 外部 provider"。  
合同 Section 5.1："provider 超时 → ✅ fallback mock，标注 turn.timeout"。

不 retry 是正确的决策：retry 会延长 turn 耗时，可能触发 SSE no-progress timeout，且在模型服务不稳定时 retry 成功率低。直接 fallback mock 保证评审流程不阻塞。

### 5.3 Circuit Breaker

合同 Section 4.3 完整设计：

| 状态 | 行为 | 转换条件 |
|------|------|---------|
| CLOSED | 正常调用 | 5 次连续失败 → OPEN |
| OPEN | 拒绝调用，返回 mock | 15 分钟后 → HALF_OPEN |
| HALF_OPEN | 接受 1 次探测 | 成功 → CLOSED；失败 → OPEN |

状态机清晰，转换条件明确。

---

## 6. 是否明确 fallback 策略

**结论：✅ 决策矩阵 + Silent Fallback 禁止。**

### 6.1 Fallback 决策矩阵

合同 Section 5.1 覆盖 8 个场景：

| 场景 | Fallback mock? | 理由 |
|------|---------------|------|
| provider 超时 | ✅ | 不阻塞评审 |
| provider HTTP 5xx | ✅ | 服务异常 |
| provider JSON 解析失败 | ✅ | 模型输出不可控 |
| Guard 拦截 | ❌ | 配置错误，必须修复 |
| Circuit breaker OPEN | ✅ | 保护外部服务 |
| 超预算 | ✅ | 成本控制优先 |
| API Key 错误 401 | ❌ | 配置错误，必须修复 |
| 需要真实模型但未授权 | ❌ | 预期行为 |

**关键设计**：运行时错误（超时、5xx、parse error、circuit open、超预算）→ fallback mock；配置错误（Guard 拦截、401）→ 拒绝执行。这确保了配置问题不会被静默吞掉。

### 6.2 Silent Fallback 禁止

合同 Section 5.2：

```
所有 fallback 必须记录：
- 日志级别：warn
- 消息格式：[Fallback] ${provider} → mock, reason: ${reason}
- Report 标注：source: 'mock_fallback' + generatedFromTurns: false

不允许：无声地从 lmstudio/openai 降级到 mock 而没有任何日志或标记。
```

与现有 `getReport()` 的 `source: 'mock_fallback'` 标注一致（`reviews.service.ts`）。

### 6.3 401 与 Circuit Breaker 的交互

401 不触发单次 fallback，但连续 5 次 401 会触发 circuit breaker → OPEN → 后续调用 fallback mock。这是合理的设计：给运维一个修复窗口，同时防止无限 401 循环。

---

## 7. 是否不接主链路

**结论：✅ 明确隔离。**

合同 Section 8 — Sprint 4.4B 实现边界：

```
✅ 不接 queue 主链路
✅ 不接 Meeting SSE
✅ 不改前端
✅ mock 默认
❌ 不接真实 LLM 到主链路
```

当前主链路状态（交叉验证）：

| 组件 | 当前 provider 调用 | 4.4B 预期 |
|------|-------------------|-----------|
| `queue.service.ts` | 内置 MOCK_RESPONSES，零 provider 调用 | 不变 |
| `reviews.gateway.ts` | MOCK_AGENT_CONTENT（SSE mock），零 provider 调用 | 不变 |
| `reviews.service.ts` | 零 provider 调用 | 不变 |
| `provider-adapter.js` | 独立脚本，不被 NestJS import | 独立 spike 测试 |

**queue.service.ts 与 provider-adapter.js 之间零耦合**——queue 有自己的 MOCK_RESPONSES（line 174-180），provider-adapter 也有自己的 MOCK_RESPONSES（line 15-21）。两份 mock 数据内容相同但物理隔离。4.4B 只需扩展 provider-adapter，不动 queue。

---

## 8. 是否建议进入 4.4B standalone spike

**结论：✅ 建议进入。**

合同 Section 8 清晰列出了 4.4B 允许/禁止事项：

### 允许（✅）

```
✅ provider-adapter.js 扩展（openai_compatible）
✅ scripts/spike-agent-turn.js 测试
✅ 预算记录（内存 + 日志）
✅ circuit breaker（内存状态）
✅ mock 默认
✅ LM Studio 需显式开启
✅ OpenAI Compatible 需 API Key + ALLOW_EXTERNAL_MODEL_CALLS
```

### 禁止（❌）

```
❌ 不接真实 LLM 到主链路
❌ 不提交 API Key
❌ 不接 RAG/Embedding/MinIO
```

### 评估

| 维度 | 评估 |
|------|------|
| 风险可控 | ✅ standalone spike，不影响主链路 |
| 可独立验证 | ✅ spike-agent-turn.js 可直接测试 |
| 回退成本低 | ✅ mock 默认，删除 env 即可回退 |
| 不引入新依赖 | ✅ 无 Redis/BullMQ/MinIO 依赖 |
| 不改前端 | ✅ MeetingPage / useMeetingSSE 零改动 |
| 不改 schema | ✅ Prisma 零改动 |

**合同为 4.4B 设定了合理的安全边界，spike 可独立进行和验证。**

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。**

---

## P2 可延后项

### P2-1: 环境变量命名不一致（现有代码 vs 合同）

- **问题**: 合同统一使用 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_TIMEOUT_MS`，但现有 `provider-adapter.js` 使用 `LMSTUDIO_BASE_URL`、`LMSTUDIO_MODEL`，且 `TIMEOUT_MS` 和 `max_tokens` 为硬编码常量（非 env var）。
- **合同设计**: Section 2.2 明确 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_TIMEOUT_MS`、`MODEL_MAX_TOKENS` 为统一变量名。
- **影响**: 4.4B 实现时需重构 provider-adapter.js 变量名，向后兼容或迁移。
- **建议**: 4.4B 统一使用合同定义的变量名，保留旧变量名作为 fallback（`MODEL_BASE_URL || LMSTUDIO_BASE_URL`）。

### P2-2: ALLOW_EXTERNAL_MODEL_CALLS 语义差异

- **问题**: 合同定义类型为 `"true" | ""`（空字符串 = 禁止），但 `.env.example` 当前值为 `ALLOW_EXTERNAL_MODEL_CALLS=false`（布尔字符串 "false"）。
- **合同**: `""` 表示禁止，`"true"` 表示允许。
- **现有代码**: `provider-adapter.js:141` — `allow !== 'true'`，即 `"false"` 和 `""` 都会阻止。
- **影响**: 功能无差异（`"false"` 和 `""` 都不等于 `"true"`），但语义不一致可能导致实现时混淆。
- **建议**: 4.4B 统一为 `process.env.ALLOW_EXTERNAL_MODEL_CALLS === 'true'`，并更新 `.env.example` 注释说明"只有 'true' 才允许"。

### P2-3: 预算记录进程重启丢失

- **问题**: 合同 Section 4.1 — "记录方式：内存累计（进程重启丢失）"。进程重启后预算计数归零，理论上可以在重启后继续消耗预算。
- **影响**: Mock/spike 阶段可接受（开发环境频繁重启），但生产环境需要持久化（Redis 或 DB）。
- **建议**: 合同已标注"进程重启丢失"为已知限制，4.4B 实现时可在 `ModelCallRecord` 中预留 `persistTo` 字段，为后续 BullMQ + Redis 持久化做准备。

### P2-4: ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL 遗留变量

- **问题**: `.env.example:22` 定义了 `ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL=false`，但合同全文未提及此变量。
- **影响**: 该变量可能属于未来安全特性（禁止真实文档发送到外部模型），但当前无代码引用，语义不明确。
- **建议**: 4.4B 决定保留（补充合同）或清理（从 .env.example 移除）。如保留，需在合同中定义其与 `ALLOW_EXTERNAL_MODEL_CALLS` 的关系。

### P2-5: openai_compatible 缺少 retry 的指数退避设计

- **问题**: 合同 Section 4.2 明确"不 retry 外部 provider"（超时 → turn.timeout），但未讨论未来是否引入 retry 以及 retry 时的退避策略。
- **影响**: 当前不 retry 是正确决策（避免阻塞 SSE），但如果未来引入 retry，需要指数退避 + jitter 防止雪崩。
- **建议**: 可在合同末尾补充"未来扩展：如引入 retry，必须使用指数退避（1s → 2s → 4s），最多 2 次"。

---

## 与现有代码的兼容性分析

### 现有 Provider 架构

```
provider-adapter.js (scripts/)        queue.service.ts (NestJS/)
├── mockProvider()                    ├── MOCK_RESPONSES (内置)
├── lmstudioProvider()                └── executeAgentTurn()
├── getProvider()                         └── 直接使用 MOCK_RESPONSES
└── guard()                               └── 不调用 provider-adapter
```

两套 mock 数据物理隔离，4.4B 扩展 provider-adapter.js 不影响 queue.service.ts。

### 4.4B 预期变更范围

| 文件 | 变更类型 | 复杂度 |
|------|---------|--------|
| `scripts/provider-adapter.js` | 扩展 openai_compatible provider | 中 |
| `scripts/spike-agent-turn.js` | 新增/扩展 spike 测试 | 低 |
| `.env.example` | 新增 MODEL_API_KEY 等注释 | 低 |
| queue.service.ts | ❌ 不改 | — |
| reviews.gateway.ts | ❌ 不改 | — |
| reviews.service.ts | ❌ 不改 | — |
| 前端 | ❌ 不改 | — |
| Prisma schema | ❌ 不改 | — |

---

## 合同完整性评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 安全性（Guard + API Key） | 5/5 | 双闸 + 四禁，无死角 |
| 预算保护 | 4.5/5 | 三层兜底，进程重启丢失为已知限制 |
| Fallback 策略 | 5/5 | 8 场景矩阵 + Silent Fallback 禁止 |
| 实现边界 | 5/5 | 明确隔离，不接主链路 |
| 向后兼容 | 4/5 | env var 命名需迁移（P2-1） |
| 可测试性 | 5/5 | standalone spike，可独立验证 |
| 文档质量 | 5/5 | 表格清晰，示例具体，无歧义 |

**综合评分：4.8/5**

---

## 建议

**建议进入 Sprint 4.4B — Provider Guard Standalone Spike。**

合同设计完整，安全边界清晰，实现范围可控。4.4B 可在不触碰主链路的情况下独立验证 provider adapter + budget guard + circuit breaker 的正确性。

### 4.4B 实现建议

1. 统一环境变量命名为合同定义（`MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_TIMEOUT_MS`、`MODEL_MAX_TOKENS`）
2. 更新 `.env.example` 中 `ALLOW_EXTERNAL_MODEL_CALLS` 的注释，说明只有 `"true"` 才允许
3. 决定 `ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL` 的去留
4. 在 spike 测试中验证：Guard 矩阵 6 个场景、fallback 矩阵 8 个场景、circuit breaker 3 个状态转换
5. 确保 HTTP client 不打印 request headers（含 API Key）
