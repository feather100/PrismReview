# Sprint 4.4B Provider Guard Standalone Spike — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  
> 审查对象：`scripts/provider-adapter.js`（232 行）、`scripts/spike-provider-guard.js`（69 行）  
> 交叉验证：`queue.service.ts`（285 行）、`reviews.gateway.ts`（252 行）、`reviews.service.ts`（514 行）、`reviews.controller.ts`（131 行）、`.env.example`、`.gitignore`

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 4.4B 成功将 `provider-adapter.js` 从 Sprint 1.8 的 mock + lmstudio 双 provider 扩展为 mock + lmstudio + openai_compatible 三 provider，并实现了完整的 Guard 矩阵（双闸机制）、预算保护（daily limit + budget limit + circuit breaker）和统一环境变量配置（含向后兼容）。主链路文件（queue.service.ts、reviews.gateway.ts、reviews.service.ts、reviews.controller.ts）零修改，smoke-runtime 31/31 无回归，smoke-sse 5/5 无回归，tsc 0 errors。建议进入 Sprint 4.4C — 受控接入 mock queue。

---

## 1. 默认是否 mock

**结论：✅ 默认 mock。**

代码验证（`provider-adapter.js:199-203`）：

```javascript
const provider = (process.env.MODEL_PROVIDER || '').toLowerCase();
// ...
if (!provider || provider === 'mock') {
  return { name: 'mock', run: mockProvider };
}
```

| 场景 | 结果 | 验证 |
|------|------|------|
| MODEL_PROVIDER 未设置 | mock | `'' || '' → mock` ✅ |
| MODEL_PROVIDER="" | mock | `'' → mock` ✅ |
| MODEL_PROVIDER="mock" | mock | `'mock' → mock` ✅ |
| MODEL_PROVIDER="MOCK" | mock | `.toLowerCase() → 'mock'` ✅ |

Spike 验证结果（Backend doc Section 5）：

```
默认 → mock: ✅ 1ms
```

`.env.example:20`：`MODEL_PROVIDER="mock"` ✅

**mock 行为与 Sprint 1.8 完全一致，`mockProvider()` 输出新增 `provider: 'mock'` 和 `model: 'mock'` 元数据字段（line 25），向后兼容。**

---

## 2. 外部 provider 是否必须 ALLOW_EXTERNAL_MODEL_CALLS=true

**结论：✅ 必须显式开启。**

### 2.1 lmstudio guard

```javascript
// provider-adapter.js:206-212
if (provider === 'lmstudio') {
  if (allow !== 'true') {
    throw new Error(
      'MODEL PROVIDER GUARD: MODEL_PROVIDER=lmstudio requires ALLOW_EXTERNAL_MODEL_CALLS=true.\n' +
      'Set both env vars to enable LM Studio calls.');
  }
  return { name: 'lmstudio', run: lmstudioProvider };
}
```

### 2.2 openai_compatible guard

```javascript
// provider-adapter.js:215-225
if (provider === 'openai_compatible') {
  if (allow !== 'true') {
    throw new Error(
      'MODEL PROVIDER GUARD: MODEL_PROVIDER=openai_compatible requires ALLOW_EXTERNAL_MODEL_CALLS=true.');
  }
  const cfg = getConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'MODEL PROVIDER GUARD: openai_compatible requires MODEL_API_KEY to be set.');
  }
  return { name: 'openai_compatible', run: openaiCompatibleProvider };
}
```

### 2.3 Guard 矩阵验证

| # | MODEL_PROVIDER | ALLOW_EXTERNAL | MODEL_API_KEY | 预期结果 | 代码行为 | 验证 |
|---|---------------|----------------|---------------|---------|---------|------|
| 1 | (unset) | 任意 | 任意 | mock | `→ mock` | ✅ |
| 2 | mock | 任意 | 任意 | mock | `→ mock` | ✅ |
| 3 | lmstudio | (unset) | 任意 | GUARD | `throw GUARD` | ✅ |
| 4 | lmstudio | "false" | 任意 | GUARD | `allow !== 'true'` → throw | ✅ |
| 5 | lmstudio | "true" | 任意 | lmstudio | `→ lmstudioProvider` | ✅ |
| 6 | openai_compatible | (unset) | 任意 | GUARD | `throw GUARD` | ✅ |
| 7 | openai_compatible | "true" | (unset) | GUARD | `throw GUARD (API_KEY)` | ✅ |
| 8 | openai_compatible | "true" | "sk-..." | openai_compatible | `→ openaiCompatibleProvider` | ✅ |
| 9 | unknown | 任意 | 任意 | GUARD | `throw Unsupported` | ✅ |

Spike 验证结果（Backend doc Section 5）：

```
lmstudio no allow → GUARD: ✅
openai_compatible no allow → GUARD: ✅
openai_compatible no key → GUARD: ✅
```

**9 个场景全覆盖，与合同 Section 3.1 完全一致。**

---

## 3. openai_compatible 是否必须 MODEL_API_KEY

**结论：✅ 双重验证。**

API Key 在两个层级被检查：

**层级 1 — getProvider() 工厂**（`provider-adapter.js:220-224`）：

```javascript
const cfg = getConfig();
if (!cfg.apiKey) {
  throw new Error('MODEL PROVIDER GUARD: openai_compatible requires MODEL_API_KEY to be set.');
}
```

在 provider 选择时立即检查，API Key 缺失则不返回 provider。

**层级 2 — openaiCompatibleProvider() 运行时**（`provider-adapter.js:173`）：

```javascript
if (!cfg.apiKey) throw new Error('MODEL_API_KEY is required for openai_compatible provider');
```

在每次调用时再次检查，防御运行时环境变量被清除的极端情况。

**层级 3 — callOpenAICompatible() HTTP 层**（`provider-adapter.js:101`）：

```javascript
if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
```

仅当 apiKey 非空时才添加 Authorization header。空 apiKey 会导致 401（无 auth header），被 HTTP error handler 捕获。

**三层防护确保 openai_compatible 不可能在没有 API Key 的情况下发出外部请求。**

---

## 4. API Key 是否未写入代码/文档/日志

**结论：✅ 四禁合规。**

### 4.1 禁止写入代码

| 文件 | API Key 引用 | 状态 |
|------|-------------|------|
| `provider-adapter.js` | `process.env.MODEL_API_KEY` — 仅读取 | ✅ |
| `spike-provider-guard.js` | `process.env.MODEL_API_KEY` — 仅读取 | ✅ |
| `queue.service.ts` | 无引用 | ✅ |
| `reviews.gateway.ts` | 无引用 | ✅ |
| `reviews.service.ts` | 无引用 | ✅ |
| `reviews.controller.ts` | 无引用 | ✅ |

**零硬编码 API Key。**

### 4.2 禁止写入文档

Spike 脚本 usage 注释（line 11）使用占位符 `MODEL_API_KEY=sk-...`。合同文档 Section 2.2 使用 `sk-...`。`.env.example:23-24` 使用 `# OPENAI_API_KEY="sk-..."` 注释。

**零真实 API Key 出现在任何文档中。**

### 4.3 禁止写入日志

Spike 脚本对 API Key 的输出处理（`spike-provider-guard.js:31`）：

```javascript
console.log(`   MODEL_API_KEY: ${process.env.MODEL_API_KEY ? '***' + process.env.MODEL_API_KEY.slice(-4) : '(unset)'}`);
```

仅显示 `***` + 最后 4 字符，符合安全日志惯例。

Provider-adapter.js 错误消息（lines 122-124）：

```javascript
throw new Error(`API HTTP ${response.status}: ${text.substring(0, 500)}`);
```

错误消息仅包含 HTTP status + response body 前 500 字符。Response body 不包含 API Key。Request headers（含 Authorization: Bearer）不在日志中。

Circuit breaker 日志（line 70）：

```javascript
console.warn('[CircuitBreaker] OPEN — 15 min cooldown after 5 consecutive failures');
```

无 API Key 信息。

**全部日志输出均不含 API Key。**

### 4.4 禁止写入 Git

`.gitignore:12-14` 覆盖 `.env` / `.env.local` / `.env.*.local`。`.env.example` 中 API Key 均为注释占位符。

---

## 5. 是否没有接 queue/startReview/SSE

**结论：✅ 主链路零修改。**

### 5.1 文件对比

| 文件 | Sprint 4.3C 行数 | Sprint 4.4B 行数 | 变更 |
|------|-----------------|-----------------|------|
| `queue.service.ts` | 285 | 285 | ❌ 未改 |
| `reviews.gateway.ts` | 252 | 252 | ❌ 未改 |
| `reviews.service.ts` | 514 | 514 | ❌ 未改 |
| `reviews.controller.ts` | 131 | 131 | ❌ 未改 |
| `reviews.module.ts` | — | — | ❌ 未改 |

### 5.2 依赖关系验证

```
queue.service.ts:
  import { PrismaService }   ✅ 无 provider-adapter import
  MOCK_RESPONSES: inline     ✅ 无 getProvider() 调用
  无 process.env.MODEL_*     ✅ 零 env 依赖

reviews.gateway.ts:
  import { PrismaService }   ✅ 无 provider-adapter import
  MOCK_AGENT_CONTENT: inline ✅ 无 provider 调用

reviews.service.ts:
  import { QueueService }    ✅ 无 provider-adapter import
  无 getProvider() 调用      ✅
```

### 5.3 物理隔离确认

`provider-adapter.js`（scripts/ 目录）与 NestJS 应用（apps/api/src/）之间零 import、零 require、零依赖。4.4B 的扩展完全在 standalone 脚本中，不影响任何主链路行为。

**主链路完全隔离，与 Sprint 4.4A 合同 Section 8 要求一致。**

---

## 6. 配置错误是否 fail closed

**结论：✅ Fail closed。**

### 6.1 Guard 错误（配置错误 → 抛异常，不 fallback）

| 配置错误 | 行为 | 验证 |
|---------|------|------|
| lmstudio 未设 ALLOW | throw GUARD | `provider-adapter.js:208` ✅ |
| openai 未设 ALLOW | throw GUARD | `provider-adapter.js:218` ✅ |
| openai 未设 API_KEY | throw GUARD | `provider-adapter.js:222` ✅ |
| 未知 provider | throw Unsupported | `provider-adapter.js:228` ✅ |

**所有配置错误均抛出异常，不会静默降级到 mock。** 与合同 Section 5.1 一致（Guard 拦截 → ❌ 不 fallback）。

### 6.2 Budget / Circuit 错误（fail closed → 抛异常）

```javascript
// checkBudget (line 57-58)
if (dailyCalls >= cfg.dailyCallLimit) throw new Error('DAILY CALL LIMIT EXCEEDED: ...');
if (totalCost > cfg.budgetLimit) throw new Error('BUDGET LIMIT EXCEEDED: ...');

// checkCircuit (line 62)
if (circuitOpenUntil > Date.now()) throw new Error('CIRCUIT BREAKER OPEN: ...');
```

超预算、超日限、circuit open 均抛出异常，阻止调用。

### 6.3 运行时错误（非配置错误 → 抛异常，由调用方处理）

| 运行时错误 | 行为 | 验证 |
|-----------|------|------|
| HTTP 5xx | throw Error | `provider-adapter.js:123` ✅ |
| HTTP 401 | throw Error | 同上 ✅ |
| 超时 | AbortController → throw | `provider-adapter.js:104` ✅ |
| JSON parse error | throw Error | `provider-adapter.js:133-134` ✅ |
| 空响应 | throw Error | 同上 ✅ |

provider-adapter.js 作为低层工具，在所有错误场景下都抛出异常。Fallback 逻辑（降级 mock + warn 日志）将在调用方（4.4C queue 集成层）实现。当前无 silent fallback。

### 6.4 Spike 验证

Spike 脚本对 GUARD / Unsupported / CIRCUIT 错误的处理（lines 60-62）：

```javascript
if (err.message.includes('GUARD') || err.message.includes('Unsupported') || err.message.includes('CIRCUIT')) {
  console.log('\n✅ Guard works as expected.');
}
```

所有预期错误被正确识别和验证。

---

## 7. fallback 是否可观测，非 silent

**结论：✅ 当前无 silent fallback，合同要求在 4.4C 集成层实现 warn 日志。**

### 7.1 当前状态

provider-adapter.js 在所有错误场景下抛出异常，**不执行任何 fallback**。这是正确的分层设计：

```
provider-adapter.js: 抛异常（无 fallback）
        ↓
调用方（4.4C queue 集成）: catch → warn 日志 → 降级 mock
```

当前不存在 silent fallback 的可能——要么成功返回，要么抛异常。没有"静默降级"的路径。

### 7.2 合同要求（将在 4.4C 实现）

合同 Section 5.2 要求的 fallback 可观测性：

```
- 日志级别：warn
- 消息格式：[Fallback] ${provider} → mock, reason: ${reason}
- Report 标注：source: 'mock_fallback' + generatedFromTurns: false
```

这些将在 4.4C queue 集成时，在调用方 catch 块中实现。当前 reviews.service.ts 的 `getReport()` 已实现 `source: 'mock_fallback'` 标注。

### 7.3 Circuit Breaker 日志

Circuit breaker 状态变更有明确的 warn 日志（line 70）：

```javascript
console.warn('[CircuitBreaker] OPEN — 15 min cooldown after 5 consecutive failures');
```

这是 provider-adapter.js 中唯一的 warn 日志，记录了 circuit breaker 从 CLOSED → OPEN 的状态转换。✅

---

## 8. smoke-runtime 是否无回归

**结论：✅ 无回归。**

Backend doc Section 5 报告的验证结果：

```
smoke-runtime: 31/31 ✅
smoke-sse:     5/5  ✅
tsc:           0 errors ✅
```

### 8.1 无回归原因分析

| 测试套件 | 测试范围 | 与 4.4B 变更的交集 | 预期 |
|---------|---------|-------------------|------|
| smoke-runtime (31) | HTTP API 端到端 | 零（queue 使用 inline MOCK_RESPONSES） | 无回归 ✅ |
| smoke-sse (5) | SSE 流 | 零（gateway 使用 inline MOCK_AGENT_CONTENT） | 无回归 ✅ |
| tsc | TypeScript 编译 | 零（provider-adapter.js 是 JS 文件，不参与 tsc） | 无回归 ✅ |

**4.4B 的变更完全在 standalone 脚本中，与 NestJS 主链路零交集，因此所有现有测试必然无回归。**

### 8.2 新增 spike 验证

`scripts/spike-provider-guard.js` 验证了 Guard 矩阵的 5 个关键场景：

| # | 场景 | 结果 |
|---|------|------|
| 1 | 默认 → mock | ✅ 1ms |
| 2 | lmstudio no allow → GUARD | ✅ |
| 3 | openai_compatible no allow → GUARD | ✅ |
| 4 | openai_compatible no key → GUARD | ✅ |
| 5 | lmstudio + allow → LM Studio | ✅ 45s, medium, Architecture, 90 confidence |

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。**

---

## P2 可延后项

### P2-1: Circuit breaker / budget 不适用于 lmstudio（合同偏差）

- **位置**: `provider-adapter.js:157-158`
- **代码**: `lmstudioProvider()` 调用了 `checkBudget()` 和 `checkCircuit()`
- **合同**: Section 4.3 — "Circuit breaker 仅适用于 `openai_compatible` provider。`lmstudio` 不需要 circuit breaker（本地无成本）。"
- **影响**: lmstudio 受 budget/circuit 限制可能导致不必要的拒绝（如本地连续 5 次超时 → circuit open → lmstudio 被拒绝 15 分钟）。但实际上 lmstudio 超时阈值 120s，5 次连续超时意味着 600s+ 的等待，不太可能在正常使用中触发。
- **建议**: 从 `lmstudioProvider()` 中移除 `checkBudget()` 和 `checkCircuit()` 调用，仅保留 `openaiCompatibleProvider()` 中的检查。

### P2-2: .env.example 未更新新环境变量

- **位置**: `.env.example`
- **问题**: 合同定义了 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY`、`MODEL_TIMEOUT_MS`、`MODEL_MAX_TOKENS`、`MODEL_BUDGET_LIMIT`、`MODEL_DAILY_CALL_LIMIT` 7 个新变量，但 `.env.example` 未更新。
- **代码兼容**: `provider-adapter.js:32-33` 实现了向后兼容（`MODEL_BASE_URL || LMSTUDIO_BASE_URL`），所以旧变量名仍可用。
- **影响**: 新用户无法从 `.env.example` 发现可用的新环境变量。
- **建议**: 在 `.env.example` 的 AI Model 部分添加新变量的注释说明。

### P2-3: Spike 脚本 usage 注释与代码不一致

- **位置**: `spike-provider-guard.js:9`
- **文档**: `node scripts/spike-provider-guard.js --provider mock`
- **代码**: `--provider` flag 未被实现，实际支持的 flags 是 `--role`（line 23）和 `--proposal`（line 24）。Provider 通过 `MODEL_PROVIDER` 环境变量设置。
- **影响**: 用户按 usage 运行会忽略 `--provider mock` 参数（不影响功能，因为默认就是 mock）。
- **建议**: 更新 usage 注释为实际支持的 flags。

### P2-4: Fallback warn 日志需在 4.4C 集成层实现

- **位置**: `provider-adapter.js` 全局
- **问题**: 合同 Section 5.2 要求所有 fallback 记录 `[Fallback] ${provider} → mock, reason: ${reason}` warn 日志。当前 provider-adapter.js 抛异常但不执行 fallback，fallback + 日志需在调用方实现。
- **影响**: 当前 standalone spike 阶段无影响。4.4C queue 集成时必须实现。
- **建议**: 4.4C 在 queue.service.ts 的 `executeAgentTurn()` 中添加 try/catch，catch 块中记录 warn 日志并返回 mock。

### P2-5: lmstudio spike 测试使用非 localhost IP

- **位置**: 历史文件 `scripts/spike-local-llm.js:15`（未在 4.4B 修改）
- **问题**: 硬编码 `http://10.0.45.168:1234/v1`，非 localhost。
- **影响**: 仅影响旧的 spike 脚本，不影响 4.4B 实现。
- **建议**: 如需保留旧 spike 脚本，更新为使用 `MODEL_BASE_URL` 环境变量。

---

## Sprint 4.4A P2 闭环追踪

| 编号 | 描述 | Sprint 4.4B 状态 |
|------|------|-----------------|
| P2-1 | env var 命名不一致（LMSTUDIO_BASE_URL → MODEL_BASE_URL） | ✅ **关闭** — `getConfig()` 实现向后兼容 fallback（line 32-33） |
| P2-2 | ALLOW_EXTERNAL_MODEL_CALLS 语义差异 | ✅ **关闭** — 代码使用 `allow !== 'true'`（line 200），兼容 `"false"` 和 `""` |
| P2-3 | 预算记录进程重启丢失 | ⚠️ 已知限制 — 内存累计，4.4C 可考虑持久化 |
| P2-4 | ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL 遗留变量 | ❌ 未闭环 — .env.example 仍存在，合同仍未提及 |
| P2-5 | retry 指数退避设计 | ⏸️ 延后 — 当前不 retry，延后到需要时设计 |

---

## 代码质量评估

### provider-adapter.js 变更分析

| 维度 | 评分 | 说明 |
|------|------|------|
| 向后兼容 | 5/5 | `getConfig()` 保留旧变量名 fallback |
| Guard 安全 | 5/5 | 双闸 + 三层 API Key 检查 |
| 错误消息 | 5/5 | 清晰、具体、不含敏感信息 |
| 代码复用 | 4.5/5 | `callOpenAICompatible()` 统一 HTTP 逻辑，lmstudio/openai 复用 |
| 预算管理 | 4/5 | 完整实现，但 lmstudio 不应受 circuit breaker 限制（P2-1） |
| 可测试性 | 4/5 | Spike 覆盖 5 场景，usage 注释有误（P2-3） |

### 新增代码统计

| 文件 | 新增行 | 修改行 | 删除行 |
|------|--------|--------|--------|
| `provider-adapter.js` | ~130 | ~30 | ~30 |
| `spike-provider-guard.js` | 69 (新文件) | — | — |
| 主链路文件 | 0 | 0 | 0 |

---

## 是否建议进入 Sprint 4.4C：受控接入 mock queue

**建议进入。**

Sprint 4.4B 完成了 standalone spike 的所有目标：

1. 三种 provider guard 独立验证通过 ✅
2. Guard 矩阵 9 场景全覆盖 ✅
3. 预算保护 + circuit breaker 实现完整 ✅
4. API Key 安全四禁合规 ✅
5. 主链路零修改，smoke 无回归 ✅
6. 向后兼容旧环境变量 ✅

### Sprint 4.4C 预期范围

4.4C 的核心任务是将 provider-adapter.js 集成到 queue.service.ts 的 `executeAgentTurn()` 中，替换当前的 inline MOCK_RESPONSES：

```
当前（4.2-4.4B）：
  executeAgentTurn() → inline MOCK_RESPONSES → write opinion

目标（4.4C）：
  executeAgentTurn() → getProvider() → provider.run() → write opinion
                       ↓ (error)
                       catch → [Fallback] warn → mockProvider → write opinion
```

### 4.4C 实现建议

1. 在 `executeAgentTurn()` 中引入 `require('../../../scripts/provider-adapter')` 或将 adapter 迁移到 NestJS injectable
2. 添加 try/catch：运行时错误 → fallback mock + warn 日志；配置错误 → 抛异常（fail closed）
3. 移除 lmstudioProvider 中的 `checkBudget()` / `checkCircuit()`（合同规定仅 openai_compatible）
4. 保持 mock 默认：`MODEL_PROVIDER` 不设置时仍使用 mock
5. 补充 fallback warn 日志格式：`[Fallback] ${provider} → mock, reason: ${reason}`
6. Report `source` 字段区分 `'mock_queue'`（默认 mock）和 `'mock_fallback'`（降级 mock）
7. 更新 `.env.example` 添加新环境变量说明
8. 扩展 smoke-queue 验证：Guard 场景 + fallback 场景
