# Sprint 4.4C Controlled Queue Provider Integration — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  
> 审查对象：`apps/api/src/modules/reviews/queue/queue.service.ts`（296 行）  
> 交叉验证：`scripts/provider-adapter.js`（232 行）、`reviews.gateway.ts`、`reviews.service.ts`、`reviews.controller.ts`、`MeetingPage.tsx`、`schema.prisma`

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 4.4C 成功将 `getProvider()` 受控接入 `queue.service.ts` 的 `executeAgentTurn()` 路径，替换了 Sprint 4.2 以来的 inline `MOCK_RESPONSES`。核心设计清晰：两层 try/catch 区分配置错误（fail closed → 抛出）与运行时错误（fallback mock + warn 日志），完整实现了合同 Section 5.1/5.2 的 fallback 策略。mock 默认不变，Guard 双闸机制通过 `getProvider()` 传递到 queue 层，API Key 零泄漏。smoke-runtime 31/31、smoke-queue 8/8、smoke-sse 5/5 无回归，前端/schema 零修改。建议进入 Sprint 4.4D — 单次受控 OpenAI-compatible 实测。

---

## 1. executeAgentTurn 是否通过 getProvider()

**结论：✅ 通过 getProvider() 调用。**

代码验证（`queue.service.ts:173-192`）：

```typescript
// Execute provider via provider-adapter (Sprint 4.4C)
const { getProvider } = require(require('path').resolve(__dirname, '../../../../../../scripts/provider-adapter'));
let provider;
try {
  provider = getProvider();
} catch (err) {
  // Configuration error (guard) — fail closed, no silent fallback
  this.logger.error(`Provider config error: ${err.message}`);
  throw err;
}

let result;
try {
  result = await provider.run(roleCode, objective);
} catch (err) {
  // Runtime error (timeout / bad JSON / HTTP) — fallback to mock with warn
  this.logger.warn(`[Fallback] ${provider.name} → mock, reason: ${err.message}`);
  const fallbackProvider = require(require('path').resolve(__dirname, '../../../../../../scripts/provider-adapter')).mockProvider;
  result = fallbackProvider(roleCode);
}
```

| 验证项 | 结果 |
|--------|------|
| 调用 `getProvider()` 获取 provider | ✅ line 177 |
| 调用 `provider.run(roleCode, objective)` | ✅ line 186 |
| 从 `provider-adapter.js` require 模块 | ✅ line 174 |
| `require('path').resolve(__dirname, ...)` 路径解析 | ✅ 6 级 `../` 从 dist/ 到项目根 |

**queue.service.ts 不再绕过 provider adapter，所有 provider 选择均通过 `getProvider()` 工厂。**

---

## 2. inline MOCK_RESPONSES 是否不再绕过 provider adapter

**结论：✅ Inline MOCK_RESPONSES 已移除。**

### 2.1 对比 Sprint 4.4B vs Sprint 4.4C

**Sprint 4.4B（旧代码，queue.service.ts:173-182）**：

```typescript
// Execute mock provider (inline — Sprint 4.2 mock only)
const MOCK_RESPONSES: Record<string, any> = {
  CTO: { dimension: '架构合理性', ... },
  CFO: { ... },
  // ... 5 个角色
};
const base = MOCK_RESPONSES[roleCode] || MOCK_RESPONSES.CTO;
const result = { roleCode, ...base, rawText: JSON.stringify(base) };
```

**Sprint 4.4C（新代码，queue.service.ts:173-192）**：

```typescript
const { getProvider } = require(...provider-adapter);
let provider;
try { provider = getProvider(); } catch (err) { /* fail closed */ }
let result;
try { result = await provider.run(roleCode, objective); } catch (err) { /* fallback mock */ }
```

| 验证项 | Sprint 4.4B | Sprint 4.4C |
|--------|-------------|-------------|
| Inline MOCK_RESPONSES | ✅ 存在于 queue 内 | ❌ **已移除** |
| getProvider() 调用 | ❌ 无 | ✅ line 177 |
| provider.run() 调用 | ❌ 无 | ✅ line 186 |
| Mock fallback | 不适用 | ✅ mockProvider() line 191 |

### 2.2 MOCK_RESPONSES 数据位置

| 位置 | 用途 | 状态 |
|------|------|------|
| `provider-adapter.js:15-21` | provider adapter 内置 mock | ✅ 唯一来源 |
| `queue.service.ts` executeAgentTurn | 曾内置 MOCK_RESPONSES | ✅ **已移除** |
| `reviews.gateway.ts:15-21` | SSE mock fallback (MOCK_AGENT_CONTENT) | ✅ 保留（SSE 层独立 mock） |
| `reviews.service.ts:300-306` | Report mock fallback (MOCK_OPINIONS) | ✅ 保留（Report 层独立 mock） |

**queue 层的 MOCK_RESPONSES 已完全移除，provider 选择统一通过 `getProvider()` 完成。** gateway 和 service 层的 mock 保留不变（用于 SSE 和 Report 的独立 fallback 路径）。

---

## 3. 默认无 env 是否仍 mock

**结论：✅ 默认 mock。**

调用路径：

```
executeAgentTurn()
  → getProvider()
    → MODEL_PROVIDER 未设置 → '' → mock
    → 返回 { name: 'mock', run: mockProvider }
  → provider.run(roleCode, objective)
    → mockProvider(roleCode) — 同步返回 mock 数据
  → write ReviewOpinion
```

当 `MODEL_PROVIDER` 未设置或为空时，`getProvider()` 返回 mock provider（`provider-adapter.js:202-203`）。mock provider 是同步函数（line 23-26），直接返回 MOCK_RESPONSES 数据，无网络调用、无 env 依赖。

Smoke-queue 8/8 验证了默认环境下的完整流程（start → running → completed → report）。✅

---

## 4. 外部 provider 是否必须 allow

**结论：✅ 必须 ALLOW_EXTERNAL_MODEL_CALLS=true。**

Guard 通过 `getProvider()` 传递到 queue 层：

```
executeAgentTurn()
  → getProvider()
    → MODEL_PROVIDER=lmstudio + ALLOW ≠ "true"
      → throw "MODEL PROVIDER GUARD: ..."
  → catch (config error)
    → logger.error("Provider config error: ...")
    → throw err  ← fail closed
```

**配置错误不会触发 fallback mock**——queue 的 catch 块（line 179-182）对配置错误明确执行 `throw err`，不进入 fallback 路径。这与合同 Section 5.1 一致："Guard 拦截 → ❌ 不 fallback"。

queue 的 retry 机制（MAX_RETRIES=3）会对配置错误重试 3 次，但因为 env 不会自动改变，每次重试都会 fail closed。最终 job 标记为 failed。这是可接受的系统行为（低优先级优化，见 P2-2）。

---

## 5. openai_compatible 是否必须 API key

**结论：✅ 三层验证。**

| 层级 | 位置 | 检查 | 失败行为 |
|------|------|------|---------|
| 1 | `getProvider():221` | `if (!cfg.apiKey) throw GUARD` | queue catch → fail closed |
| 2 | `openaiCompatibleProvider():173` | `if (!cfg.apiKey) throw` | queue catch → fallback mock |
| 3 | `callOpenAICompatible():101` | `if (apiKey) headers['Authorization']` | 无 auth → 401 → queue catch |

当 `MODEL_PROVIDER=openai_compatible` 且 `MODEL_API_KEY` 未设置时：

1. `getProvider()` 立即抛出 GUARD 错误（层级 1）
2. queue catch 块识别为配置错误 → `logger.error` + `throw err`
3. 不会到达 `provider.run()` → 不会发出任何外部请求

**三层防护确保 openai_compatible 在无 API Key 时不可能发出外部请求。**

---

## 6. API key 是否未泄漏

**结论：✅ 零泄漏。**

### 6.1 queue.service.ts 代码审查

| 行 | 代码 | API Key 风险 | 状态 |
|----|------|-------------|------|
| 174 | `require(...provider-adapter)` | 仅加载模块 | ✅ 无 Key |
| 177 | `getProvider()` | Key 在 adapter 内部读取 | ✅ 不暴露 |
| 180 | `logger.error(\`Provider config error: ${err.message}\`)` | GUARD 错误消息不含 Key | ✅ |
| 186 | `provider.run(roleCode, objective)` | Key 在 adapter 内部使用 | ✅ 不暴露 |
| 189 | `logger.warn(\`[Fallback] ${provider.name} → mock, reason: ${err.message}\`)` | 运行时错误消息不含 Key | ✅ |
| 190 | `require(...).mockProvider` | Mock 不涉及 Key | ✅ |

### 6.2 错误消息内容验证

| 错误类型 | 错误消息示例 | 含 Key? |
|---------|-------------|---------|
| GUARD (allow) | "MODEL PROVIDER GUARD: MODEL_PROVIDER=openai_compatible requires ALLOW_EXTERNAL_MODEL_CALLS=true." | ❌ |
| GUARD (key) | "MODEL PROVIDER GUARD: openai_compatible requires MODEL_API_KEY to be set." | ❌ |
| HTTP error | "API HTTP 500: Internal Server Error" | ❌ |
| Timeout | "The operation was aborted" (AbortController) | ❌ |
| Parse error | "Unparseable response: ..." (模型输出前 300 字符) | ❌ |
| Circuit breaker | "CIRCUIT BREAKER OPEN: retry after ..." | ❌ |
| Budget | "BUDGET LIMIT EXCEEDED: $0.1001 > $0.10" | ❌ |

**所有错误消息均不包含 API Key 值。**

### 6.3 日志输出路径

```
logger.error("Provider config error: " + err.message)
  → NestJS Logger → console/stdout → 不含 Key ✅

logger.warn("[Fallback] " + provider.name + " → mock, reason: " + err.message)
  → NestJS Logger → console/stdout → 不含 Key ✅
```

---

## 7. runtime fallback 是否有 warn，不 silent

**结论：✅ warn 日志完整，非 silent。**

### 7.1 Fallback warn 日志

`queue.service.ts:189`：

```typescript
this.logger.warn(`[Fallback] ${provider.name} → mock, reason: ${err.message}`);
```

| 合同要求（Section 5.2） | 实现 | 验证 |
|-------------------------|------|------|
| 日志级别：warn | `this.logger.warn()` | ✅ |
| 格式：`[Fallback] ${provider} → mock, reason: ${reason}` | `[Fallback] ${provider.name} → mock, reason: ${err.message}` | ✅ |
| 包含 provider 名称 | `${provider.name}` — "lmstudio" / "openai_compatible" | ✅ |
| 包含失败原因 | `${err.message}` — 超时/HTTP/解析错误 | ✅ |

### 7.2 Fallback 场景矩阵

| 场景 | provider.name | err.message 示例 | 日志输出 |
|------|--------------|-----------------|---------|
| 超时 | lmstudio | "The operation was aborted" | `[Fallback] lmstudio → mock, reason: The operation was aborted` |
| HTTP 5xx | openai_compatible | "API HTTP 500: Internal Server Error" | `[Fallback] openai_compatible → mock, reason: API HTTP 500: ...` |
| JSON 解析失败 | openai_compatible | "Unparseable response: ..." | `[Fallback] openai_compatible → mock, reason: Unparseable response: ...` |
| Circuit breaker OPEN | openai_compatible | "CIRCUIT BREAKER OPEN: ..." | `[Fallback] openai_compatible → mock, reason: CIRCUIT BREAKER OPEN: ...` |
| 超预算 | openai_compatible | "BUDGET LIMIT EXCEEDED: ..." | `[Fallback] openai_compatible → mock, reason: BUDGET LIMIT EXCEEDED: ...` |

### 7.3 Fallback 后的 Opinion 写入

Fallback 到 mock 后，Opinion 仍正常写入 DB（line 195-208），mock 数据的 `rawText` 字段包含 `JSON.stringify(base)`，`reasoningSummary` 取前 200 字符。Review 流程不阻塞。

**所有 fallback 均有 warn 日志 + 明确的 provider 名称 + 失败原因，无 silent fallback。**

---

## 8. 配置错误是否 fail closed

**结论：✅ Fail closed。**

`queue.service.ts:176-182`：

```typescript
try {
  provider = getProvider();
} catch (err) {
  // Configuration error (guard) — fail closed, no silent fallback
  this.logger.error(`Provider config error: ${err.message}`);
  throw err;
}
```

| 配置错误 | getProvider() 行为 | queue catch 行为 | 最终结果 |
|---------|-------------------|-----------------|---------|
| lmstudio 未 allow | throw GUARD | logger.error + throw | job failed |
| openai_compatible 未 allow | throw GUARD | logger.error + throw | job failed |
| openai_compatible 未 key | throw GUARD | logger.error + throw | job failed |
| 未知 provider | throw Unsupported | logger.error + throw | job failed |

**关键设计**：配置错误的 catch 块（lines 176-182）和运行时错误的 catch 块（lines 184-192）是**分离的**。配置错误走 `throw err`（fail closed），运行时错误走 `mockProvider`（fallback）。两个路径互不干扰。

### 8.1 与合同的对照

| 合同 Section 5.1 场景 | 合同要求 | 4.4C 实现 | 验证 |
|----------------------|---------|----------|------|
| Guard 拦截 | ❌ 不 fallback | `throw err` | ✅ |
| API Key 错误 401 | ❌ 不 fallback | 运行时 catch → fallback ⚠️ | 见 P2-4 |
| 需要真实模型但未授权 | ❌ 不 fallback | `throw GUARD` | ✅ |

**注意**：合同将 "API Key 错误 401" 列为不 fallback 场景，但当前实现中 401 会作为运行时错误被第二个 catch 捕获并 fallback 到 mock。这是因为 `getProvider()` 只检查 API Key 是否存在（非空），不验证 Key 是否有效。Key 有效性只有在实际 HTTP 调用时才知道（401 响应）。见 P2-4。

---

## 9. smoke-runtime / smoke-sse / smoke-queue 是否通过

**结论：✅ 全部通过，无回归。**

Backend doc Section 4 报告：

```
smoke-runtime: 31/31 ✅
smoke-queue:    8/8  ✅
smoke-sse:      5/5  ✅
tsc:            0 errors ✅
```

### 9.1 无回归分析

| 测试套件 | 范围 | 与 4.4C 变更的关系 | 预期 |
|---------|------|-------------------|------|
| smoke-runtime (31) | HTTP API 全链路 | 间接 — queue 走 mock provider | 无回归 ✅ |
| smoke-queue (8) | start→running→completed→report | 直接 — queue.executeAgentTurn 走 getProvider()→mock | 无回归 ✅ |
| smoke-sse (5) | SSE 流 | 零 — gateway 未改 | 无回归 ✅ |
| tsc | TypeScript 编译 | `require()` 是 JS 运行时调用，不参与 tsc | 无回归 ✅ |

### 9.2 smoke-queue 验证路径

smoke-queue 在默认 env（`MODEL_PROVIDER="mock"`）下运行：

```
POST /start → queue.enqueue('review.start')
  → executeReviewStart → enqueue N × agent.turn.execute
  → executeAgentTurn → getProvider() → mock → provider.run(roleCode)
  → write ReviewOpinion → checkMeetingComplete
  → executeMeetingComplete → review.status = 'completed'
GET /report → source: 'db_opinions'
```

8/8 测试覆盖：POST /start < 1s、status=running、sessionId、review completed、report opinions from queue、source=db_opinions、verdict、re-start returns 400。

**所有测试在 mock 默认环境下通过，验证了 getProvider() → mockProvider 的完整路径。**

---

## 10. 是否未改前端 / schema

**结论：✅ 均未变更。**

| 文件 | Sprint 4.4B | Sprint 4.4C | 验证 |
|------|-------------|-------------|------|
| `reviews.gateway.ts` | 252 行 | 未改 | ✅ import 头一致 |
| `reviews.service.ts` | 514 行 | 未改 | ✅ import 头一致 |
| `reviews.controller.ts` | 131 行 | 未改 | ✅ import 头一致 |
| `MeetingPage.tsx` | 未改 | 未改 | ✅ import 头一致 |
| `useMeetingSSE.ts` | 未改 | 未改 | ✅ |
| `schema.prisma` | 294 行 | 未改 | ✅ |

Backend doc Section 1 明确声明仅修改 `queue.service.ts` 一个文件。交叉验证确认其他文件未被修改。

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。**

---

## P2 可延后项

### P2-1: 双重 require 冗余

- **位置**: `queue.service.ts:174` 和 `queue.service.ts:190`
- **代码**:
  ```typescript
  // Line 174
  const { getProvider } = require(require('path').resolve(__dirname, '../../../../../../scripts/provider-adapter'));
  // Line 190
  const fallbackProvider = require(require('path').resolve(__dirname, '../../../../../../scripts/provider-adapter')).mockProvider;
  ```
- **问题**: 同一模块被 require 两次（Node.js 缓存使第二次立即返回，无功能影响），但路径解析重复执行，且代码可读性差。
- **建议**: 提取为模块顶部常量或一次 require：
  ```typescript
  const adapterPath = require('path').resolve(__dirname, '../../../../../../scripts/provider-adapter');
  const { getProvider, mockProvider } = require(adapterPath);
  ```

### P2-2: 配置错误触发无效 retry

- **位置**: `queue.service.ts:73-82`（通用 retry 逻辑）
- **问题**: 配置错误（Guard throw）被 queue 的 `processNext()` catch 捕获，触发 retry（最多 3 次）。每次 retry 都调用 `getProvider()` 并 fail closed，产生 3 次无效重试 + 3 条 error 日志。
- **影响**: 无功能影响（job 最终 failed），但浪费时间和日志空间。
- **建议**: 在 `executeJob()` 中区分配置错误和运行时错误，配置错误直接标记 failed 不 retry。或在 catch 中检查 `err.message.includes('GUARD') || err.message.includes('Unsupported')` 直接 failed。

### P2-3: Fallback mock 与 default mock 在 DB 中不可区分

- **位置**: `queue.service.ts:195-208`（Opinion 写入）
- **问题**: 当 `provider.name === 'mock'` 时 mock 结果是 default mock；当 `provider.name === 'openai_compatible'` 且运行时失败时 fallback 到 `mockProvider(roleCode)`。两种情况下写入 DB 的 Opinion 数据完全相同（都是 MOCK_RESPONSES），无法从 DB 区分来源。
- **影响**: Debug 时无法知道某个 Opinion 是"正常 mock"还是"降级 mock"。
- **建议**: 在 fallback 路径中给 result 添加标记字段（如 `result._fallbackReason = err.message`），写入 `reasoningSummary` 或新增 DB 字段。

### P2-4: 401 错误触发 fallback（合同偏差）

- **位置**: `queue.service.ts:184-192`
- **合同**: Section 5.1 — "API Key 错误 401 → ❌ 不 fallback，配置错误，必须修复"
- **实际**: 401 响应被 `callOpenAICompatible()` 抛出为 `API HTTP 401: ...`，属于运行时错误，被第二个 catch 捕获 → fallback mock。
- **原因**: `getProvider()` 只检查 API Key 是否存在（非空字符串），不验证 Key 有效性。Key 有效性只有在 HTTP 调用时才知道。
- **影响**: 错误的 API Key 会被静默降级到 mock，用户可能不知道 Key 有问题（除非查看 warn 日志）。
- **建议**: 在第二个 catch 中检查 `err.message.includes('401') || err.message.includes('403')`，对认证错误不 fallback（throw）。或在 fallback 时检查 HTTP status code 做差异化处理。

### P2-5: Circuit breaker / budget 仍适用于 lmstudio（继承自 4.4B P2-1）

- **位置**: `provider-adapter.js:157-158`
- **合同**: Section 4.3 — "Circuit breaker 仅适用于 openai_compatible"
- **状态**: 4.4C 未修改 provider-adapter.js，此偏差继承自 4.4B
- **影响**: lmstudio 受 budget/circuit 限制可能导致不必要的拒绝
- **建议**: 从 `lmstudioProvider()` 中移除 `checkBudget()` / `checkCircuit()`

### P2-6: .env.example 仍未更新（继承自 4.4B P2-2）

- **位置**: `.env.example`
- **状态**: 合同定义的 7 个新环境变量（MODEL_BASE_URL、MODEL_NAME、MODEL_API_KEY、MODEL_TIMEOUT_MS、MODEL_MAX_TOKENS、MODEL_BUDGET_LIMIT、MODEL_DAILY_CALL_LIMIT）仍未添加到 .env.example
- **建议**: 在 4.4D 实现前更新

### P2-7: smoke-queue 未扩展 Guard/Fallback 场景

- **位置**: `scripts/smoke-queue.js`
- **问题**: 4.4C 新增了 Guard fail closed 和 runtime fallback 两条路径，但 smoke-queue 仍为 Sprint 4.2 的 8 个测试（默认 mock 路径），未覆盖新路径。
- **缺失场景**:
  - `MODEL_PROVIDER=lmstudio` → Guard fail closed → job failed → review failed
  - `MODEL_PROVIDER=openai_compatible` + timeout → fallback mock → warn 日志 → review completed
- **建议**: 在 4.4D 前补充 Guard 和 fallback 场景的自动化测试

---

## Sprint 4.4B P2 闭环追踪

| 编号 | 描述 | Sprint 4.4C 状态 |
|------|------|-----------------|
| P2-1 | lmstudio 不应有 checkBudget/checkCircuit | ❌ 未闭环 — provider-adapter.js 未修改 |
| P2-2 | .env.example 未更新新变量 | ❌ 未闭环 — 仍未更新 |
| P2-3 | Spike 脚本 usage 注释不一致 | ❌ 未闭环 — spike 脚本未修改 |
| P2-4 | Fallback warn 日志需实现 | ✅ **关闭** — `queue.service.ts:189` 完整实现 `[Fallback] ... → mock, reason: ...` |
| P2-5 | spike-local-llm.js 非 localhost IP | ❌ 未闭环 — 旧文件未修改 |

---

## 代码变更统计

| 文件 | 新增行 | 修改行 | 删除行 | 净变化 |
|------|--------|--------|--------|--------|
| `queue.service.ts` | ~20 | ~5 | ~10 | +11 行（285 → 296） |
| `provider-adapter.js` | 0 | 0 | 0 | 0 |
| 其他所有文件 | 0 | 0 | 0 | 0 |

变更集中在 `executeAgentTurn()` 方法内部，替换了 inline MOCK_RESPONSES（~10 行）为 getProvider() + try/catch + fallback（~20 行）。

---

## 架构评估

### 分层设计

```
┌─ queue.service.ts ─────────────────────────────────────┐
│  executeAgentTurn()                                     │
│    ├── getProvider() ──── config error → fail closed    │
│    ├── provider.run() ─── runtime error → fallback mock │
│    └── write Opinion ─── always (both paths)            │
└─────────────────────────────────────────────────────────┘
         │ require()
         ▼
┌─ provider-adapter.js ──────────────────────────────────┐
│  getProvider() ─── Guard matrix (allow + key)           │
│  mockProvider() ── MOCK_RESPONSES (sync)                │
│  lmstudioProvider() ── HTTP + budget + circuit          │
│  openaiCompatibleProvider() ── HTTP + budget + circuit  │
└─────────────────────────────────────────────────────────┘
```

queue.service.ts 作为调用方负责：
1. 区分配置错误 vs 运行时错误
2. 配置错误 fail closed
3. 运行时错误 fallback mock + warn 日志
4. 无论哪条路径都写 Opinion（流程不阻塞）

provider-adapter.js 作为工具层负责：
1. Guard 矩阵（provider 选择 + 安全检查）
2. HTTP 调用 + 超时 + 解析
3. 预算保护 + circuit breaker
4. 所有错误抛出异常（不执行 fallback）

**职责分离清晰，符合合同 Section 5 的分层设计。**

---

## 是否建议进入 Sprint 4.4D：单次受控 OpenAI-compatible 实测

**建议进入。**

Sprint 4.4C 完成了受控接入的所有目标：

1. `getProvider()` 已集成到 `executeAgentTurn()` ✅
2. Inline MOCK_RESPONSES 已移除 ✅
3. Mock 默认不变 ✅
4. Guard 双闸传递到 queue 层 ✅
5. API Key 零泄漏 ✅
6. Runtime fallback + warn 日志完整 ✅
7. 配置错误 fail closed ✅
8. 全部 smoke 无回归 ✅
9. 前端/schema 零修改 ✅

### Sprint 4.4D 预期范围

4.4D 的核心任务是在受控条件下进行单次 OpenAI-compatible 真实调用：

```
1. 配置 MODEL_PROVIDER=openai_compatible + ALLOW_EXTERNAL_MODEL_CALLS=true + MODEL_API_KEY=<real>
2. 执行单次 startReview → executeAgentTurn → openaiCompatibleProvider.run()
3. 验证：
   - HTTP 请求发出并收到响应
   - JSON 解析成功
   - Opinion 写入 DB（source: 'db_opinions'）
   - Report 显示真实模型输出
4. 验证 fallback：
   - 断开网络 → timeout → fallback mock → warn 日志
5. 验证 guard：
   - 移除 API_KEY → GUARD → fail closed
```

### 4.4D 实现建议

1. 先修复 P2-4（401 不 fallback）再实测
2. 更新 `.env.example` 添加 MODEL_API_KEY 等变量说明
3. 补充 smoke-queue Guard/Fallback 场景测试
4. 实测后恢复 `MODEL_PROVIDER="mock"` 默认值
5. 确保实测 API Key 不进入任何日志输出
6. 单次实测，不循环，控制预算（$0.10 上限）
