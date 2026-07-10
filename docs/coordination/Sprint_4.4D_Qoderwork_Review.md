# Sprint 4.4D Provider Safety Hardening — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  
> 审查对象：`apps/api/src/modules/reviews/queue/queue.service.ts`（320 行）、`.env.example`（52 行）  
> 交叉验证：`scripts/provider-adapter.js`（232 行）、`scripts/smoke-queue.js`（80 行）、`reviews.gateway.ts`、`reviews.service.ts`

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 4.4D 成功关闭了 Sprint 4.4C 的三项关键 P2：401/403 fail closed（不再 fallback mock）、guard 错误不 retry（NO_RETRY 机制）、`.env.example` 全面更新。错误处理从 4.4C 的两层 try/catch 升级为三层分流：guard 错误 → fail closed + NO_RETRY；401/403 → fail closed + NO_RETRY；运行时错误 → fallback mock + warn 日志。ReviewTurn 状态在 guard/auth 失败时正确标记为 `'failed'`，确保 meeting.complete 协调机制不受影响。smoke-runtime 31/31、smoke-queue 8/8、smoke-sse 5/5 无回归。

---

## 1. 401/403 是否 fail closed，绝不 fallback mock

**结论：✅ Fail closed，无 fallback。**

代码验证（`queue.service.ts:203-211`）：

```typescript
// Auth errors (401/403) — fail closed, no fallback
if (err.message.includes('HTTP 401') || err.message.includes('HTTP 403')) {
  this.logger.error(`Auth error (no fallback): ${err.message.replace(/Bearer [a-zA-Z0-9._-]+/g, 'Bearer ***')}`);
  await this.prisma.reviewTurn.update({
    where: { id: reviewTurn.id },
    data: { status: 'failed', completedAt: new Date() },
  });
  throw new Error('NO_RETRY:' + err.message);
}
```

### 1.1 执行路径

```
provider.run() → HTTP 401/403
  → callOpenAICompatible() throws "API HTTP 401: ..."
  → catch block line 202
    → line 204: 匹配 "HTTP 401"
    → line 205: logger.error (Bearer token 已脱敏)
    → line 206-209: ReviewTurn.status = 'failed'
    → line 210: throw NO_RETRY:API HTTP 401: ...
  → processNext() line 76: msg.startsWith('NO_RETRY:') = true
    → job.status = 'failed'（不 retry）
    → processedIds.add(job.id)
```

### 1.2 验证矩阵

| 场景 | fallback mock? | retry? | turn status | 验证 |
|------|---------------|--------|-------------|------|
| HTTP 401 | ❌ 不 fallback | ❌ NO_RETRY | `failed` | ✅ |
| HTTP 403 | ❌ 不 fallback | ❌ NO_RETRY | `failed` | ✅ |
| HTTP 500 | ✅ fallback | ✅ 正常 retry | `completed` | ✅ |
| Timeout | ✅ fallback | ✅ 正常 retry | `completed` | ✅ |
| Parse error | ✅ fallback | ✅ 正常 retry | `completed` | ✅ |

### 1.3 Bearer Token 脱敏

Line 205 使用正则表达式对日志中的 Bearer token 进行脱敏：

```typescript
err.message.replace(/Bearer [a-zA-Z0-9._-]+/g, 'Bearer ***')
```

虽然当前 `provider-adapter.js` 的错误消息不含 Authorization header（仅包含 response body 前 500 字符），但此脱敏是防御性编程——即使未来错误消息格式变化，也不会泄漏 token。✅

### 1.4 与合同对照

| 合同 Section 5.1 | 要求 | 4.4D 实现 | 验证 |
|------------------|------|----------|------|
| API Key 错误 401 | ❌ 不 fallback | `throw NO_RETRY` | ✅ |
| Guard 拦截 | ❌ 不 fallback | `throw NO_RETRY` | ✅ |
| provider HTTP 5xx | ✅ fallback | `mockProvider(roleCode)` | ✅ |
| provider 超时 | ✅ fallback | `mockProvider(roleCode)` | ✅ |

**Sprint 4.4C P2-4（401 fallback 合同偏差）已关闭。**

---

## 2. guard/config error 是否不会进入无效 retry

**结论：✅ NO_RETRY 机制阻止 retry。**

### 2.1 Guard 错误路径

`queue.service.ts:186-197`：

```typescript
try {
  provider = getProvider();
} catch (err) {
  // Configuration error (guard) — fail closed, no retry, no fallback
  this.logger.error(`Provider config error (no retry): ${err.message}`);
  // Mark turn as failed immediately
  await this.prisma.reviewTurn.update({
    where: { id: reviewTurn.id },
    data: { status: 'failed', completedAt: new Date() },
  });
  throw new Error('NO_RETRY:' + err.message);
}
```

### 2.2 NO_RETRY 在 processNext() 中的处理

`queue.service.ts:73-91`：

```typescript
} catch (err) {
  const msg = err.message || '';
  // NO_RETRY errors (guard/auth) — fail immediately, no retry
  if (msg.startsWith('NO_RETRY:')) {
    job.status = 'failed';
    this.processedIds.add(job.id);
    this.logger.error(`Failed (no retry): ${job.type} — ${msg.replace('NO_RETRY:', '')}`);
  } else {
    job.retries++;
    if (job.retries <= this.MAX_RETRIES) {
      job.status = 'queued';  // 正常重试
    } else {
      job.status = 'failed';  // 超过最大重试次数
    }
  }
}
```

### 2.3 对比 Sprint 4.4C vs 4.4D

| 场景 | Sprint 4.4C 行为 | Sprint 4.4D 行为 |
|------|-----------------|-----------------|
| Guard 错误 | retry 3 次 → failed（~400ms 浪费） | 立即 failed（~100ms） |
| 401/403 | fallback mock（不安全） | fail closed + NO_RETRY |
| 运行时错误 | fallback mock + warn | 不变 ✅ |
| 正常 mock | 成功 | 不变 ✅ |

### 2.4 三种 NO_RETRY 触发场景

| # | 触发条件 | 来源 | turn status | 验证 |
|---|---------|------|-------------|------|
| 1 | getProvider() guard 错误 | line 196 | `failed` | ✅ |
| 2 | HTTP 401 | line 210 | `failed` | ✅ |
| 3 | HTTP 403 | line 210 | `failed` | ✅ |

**Sprint 4.4C P2-2（配置错误无效 retry）已关闭。**

---

## 3. fallback 只用于运行时普通错误，且必须有 warn 日志

**结论：✅ Fallback 仅用于运行时错误。**

### 3.1 错误分流逻辑

```typescript
// 第一层：Guard 错误 → fail closed (line 186-197)
try { provider = getProvider(); }
catch (err) { throw NO_RETRY; }  // 不 fallback

// 第二层：provider.run() 错误
try { result = await provider.run(roleCode, objective); }
catch (err) {
  // 第二层 a：Auth 错误 → fail closed (line 204-211)
  if (err.message.includes('HTTP 401') || err.message.includes('HTTP 403')) {
    throw NO_RETRY;  // 不 fallback
  }
  // 第二层 b：运行时错误 → fallback mock (line 212-215)
  this.logger.warn(`[Fallback] ${provider.name} → mock, reason: ${err.message}`);
  result = fallbackProvider(roleCode);
}
```

### 3.2 Fallback 场景矩阵

| 错误类型 | 进入 fallback? | warn 日志? | 验证 |
|---------|---------------|-----------|------|
| Guard 错误 | ❌ NO_RETRY | error 日志 | ✅ |
| HTTP 401/403 | ❌ NO_RETRY | error 日志 | ✅ |
| HTTP 5xx | ✅ fallback | warn 日志 | ✅ |
| Timeout | ✅ fallback | warn 日志 | ✅ |
| JSON parse error | ✅ fallback | warn 日志 | ✅ |
| Circuit breaker OPEN | ✅ fallback | warn 日志 | ✅ |
| Budget exceeded | ✅ fallback | warn 日志 | ✅ |
| Daily limit exceeded | ✅ fallback | warn 日志 | ✅ |

### 3.3 Warn 日志格式

Line 213：

```typescript
this.logger.warn(`[Fallback] ${provider.name} → mock, reason: ${err.message}`);
```

与合同 Section 5.2 格式一致：`[Fallback] ${provider} → mock, reason: ${reason}`。

**只有运行时普通错误（5xx/timeout/parse/circuit/budget）才 fallback mock，且必定有 warn 日志。配置错误和认证错误绝不 fallback。**

---

## 4. API Key 是否没有进入代码、日志、文档、测试快照

**结论：✅ 四禁合规。**

### 4.1 禁止写入代码

| 文件 | API Key 引用 | 状态 |
|------|-------------|------|
| `queue.service.ts` | `require(adapterPath)` — 仅加载模块 | ✅ 无 Key |
| `provider-adapter.js` | `process.env.MODEL_API_KEY` — 仅 env 读取 | ✅ |
| `reviews.gateway.ts` | 无引用 | ✅ |
| `reviews.service.ts` | 无引用 | ✅ |

### 4.2 禁止写入日志

| 日志语句 | 位置 | 含 Key? | 验证 |
|---------|------|---------|------|
| `Provider config error (no retry): ${err.message}` | line 190 | ❌ GUARD 消息不含 Key | ✅ |
| `Auth error (no fallback): ${...Bearer ***...}` | line 205 | ❌ Bearer 已脱敏 | ✅ |
| `[Fallback] ${provider.name} → mock, reason: ${err.message}` | line 213 | ❌ 运行时错误不含 Key | ✅ |
| `Failed (no retry): ${...msg.replace('NO_RETRY:', '')...}` | line 79 | ❌ 原始错误不含 Key | ✅ |
| `Turn ${turnIndex}/${roleCode}: ...` | line 240 | ❌ 仅 riskLevel + confidence | ✅ |

### 4.3 禁止写入文档

`.env.example:35`：`# MODEL_API_KEY="sk-..."` — 注释 + 占位符。✅

### 4.4 禁止写入测试快照

`smoke-queue.js` 不包含任何 MODEL_API_KEY 引用或断言。✅

### 4.5 Bearer Token 脱敏机制

Line 205 的正则表达式 `/Bearer [a-zA-Z0-9._-]+/g` 覆盖标准 JWT 格式（base64 字符 + `.` 分隔符 + `-` `_` 特殊字符）。即使错误消息意外包含 Authorization header，token 也会被替换为 `Bearer ***`。

---

## 5. .env.example 是否只有变量名和安全说明

**结论：✅ 全面更新，安全说明清晰。**

### 5.1 新增变量（Sprint 4.4D）

| 变量 | 行号 | 说明 | 默认值 | 验证 |
|------|------|------|--------|------|
| `MODEL_PROVIDER` | 21 | Provider selection | `"mock"` | ✅ |
| `ALLOW_EXTERNAL_MODEL_CALLS` | 24 | Production safety gate | `false` | ✅ |
| `MODEL_BASE_URL` | 28 | Base URL (commented) | `http://127.0.0.1:1234/v1` | ✅ |
| `MODEL_NAME` | 31 | Model name (commented) | `google/gemma-4-12b` | ✅ |
| `MODEL_API_KEY` | 35 | API Key (commented) | `sk-...` | ✅ |
| `MODEL_TIMEOUT_MS` | 38 | Timeout (commented) | `120000` | ✅ |
| `MODEL_MAX_TOKENS` | 41 | Max tokens (commented) | `2048` | ✅ |
| `MODEL_BUDGET_LIMIT` | 44 | Budget guard (commented) | `0.10` | ✅ |
| `MODEL_DAILY_CALL_LIMIT` | 47 | Daily limit (commented) | `100` | ✅ |

### 5.2 清理项

| 变更 | 说明 | 验证 |
|------|------|------|
| 移除 `ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL` | 废弃变量 | ✅ Sprint 4.4B P2-4 关闭 |
| 移除 `OPENAI_API_KEY` | 统一为 `MODEL_API_KEY` | ✅ |
| 移除 `ANTHROPIC_API_KEY` | 统一为 `MODEL_API_KEY` | ✅ |

### 5.3 安全说明

```
# Production safety gate: must be "true" to allow external model calls
# WARNING: Never commit real API keys to Git. Use .env.local or env vars.
```

关键变量（MODEL_BASE_URL、MODEL_NAME、MODEL_API_KEY、MODEL_TIMEOUT_MS、MODEL_MAX_TOKENS、MODEL_BUDGET_LIMIT、MODEL_DAILY_CALL_LIMIT）均注释掉，需用户显式取消注释才能使用。`MODEL_PROVIDER` 和 `ALLOW_EXTERNAL_MODEL_CALLS` 保持激活状态，默认 mock + 禁止外部调用。

**Sprint 4.4B P2-2（.env.example 未更新）已关闭。**

---

## 6. smoke-queue 是否覆盖 Guard/Fallback/401 场景

**结论：⚠️ 未覆盖。smoke-queue.js 仍为 Sprint 4.2 的 8 个 happy path 测试。**

### 6.1 当前测试覆盖

| # | 测试 | 场景 | 覆盖路径 |
|---|------|------|---------|
| 1 | POST /start < 1s | happy path | mock provider |
| 2 | status=running | happy path | mock provider |
| 3 | sessionId | happy path | mock provider |
| 4 | Review completed | happy path | mock provider |
| 5 | Report opinions | happy path | mock provider |
| 6 | source=db_opinions | happy path | mock provider |
| 7 | Verdict present | happy path | mock provider |
| 8 | Re-start → 400 | happy path | idempotency |

### 6.2 缺失场景

| 场景 | 可行性 | 优先级 | 建议 |
|------|--------|--------|------|
| Guard error → NO_RETRY → review failed | ✅ 可行 — 设 `MODEL_PROVIDER=lmstudio`，不设 ALLOW | 高 | 新增测试 |
| Runtime fallback → warn → mock opinion | ⚠️ 较难 — 需要让 provider.run() 超时 | 中 | 可设 `MODEL_TIMEOUT_MS=1` 强制超时 |
| 401 → NO_RETRY → turn failed | ❌ 困难 — 需要 mock HTTP 401 | 中 | 适合 integration test |

### 6.3 Guard error 测试方案（可直接实现）

```javascript
// 在 smoke-queue 中新增：
process.env.MODEL_PROVIDER = 'lmstudio';
// 不设 ALLOW_EXTERNAL_MODEL_CALLS
// → getProvider() throws GUARD → NO_RETRY → turn failed
// 验证：review 最终 status 应含 failed turns
```

**虽然 4.4D 的三项核心修复（401 fail closed、NO_RETRY、.env.example）均已通过代码审查确认正确，但自动化测试覆盖缺失增加了后续重构的回归风险。**

---

## 7. 主链路是否仍默认 mock，未真实调用外部模型

**结论：✅ 默认 mock。**

### 7.1 默认环境路径

```
.env: MODEL_PROVIDER="mock", ALLOW_EXTERNAL_MODEL_CALLS=false
  → getProvider() → mock provider
  → mockProvider(roleCode) — 同步返回，零网络调用
  → write ReviewOpinion
```

### 7.2 验证

| 检查项 | 结果 |
|--------|------|
| `.env` 中 MODEL_PROVIDER | `"mock"` ✅ |
| `.env` 中 ALLOW_EXTERNAL_MODEL_CALLS | `false` ✅ |
| `.env.example` 中 MODEL_PROVIDER | `"mock"` ✅ |
| `getProvider()` 默认行为 | mock ✅ |
| smoke-queue 8/8 | 默认 mock 环境通过 ✅ |
| smoke-runtime 31/31 | 默认 mock 环境通过 ✅ |

**零外部模型调用发生。主链路在默认配置下完全使用 mock provider。**

---

## 8. 无前端、schema、SSE 非必要改动

**结论：✅ 均无改动。**

| 文件 | Sprint 4.4C | Sprint 4.4D | 验证 |
|------|-------------|-------------|------|
| `reviews.gateway.ts` | 未改 | 未改 | ✅ import 头一致 |
| `reviews.service.ts` | 未改 | 未改 | ✅ import 头一致 |
| `reviews.controller.ts` | 未改 | 未改 | ✅ |
| `MeetingPage.tsx` | 未改 | 未改 | ✅ |
| `useMeetingSSE.ts` | 未改 | 未改 | ✅ |
| `schema.prisma` | 未改 | 未改 | ✅ |
| `provider-adapter.js` | 未改 | 未改（仍标注 Sprint 4.4B） | ✅ |

Backend doc Section 1 声明仅修改 `queue.service.ts` 和 `.env.example`，交叉验证确认。

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。**

---

## P2 可延后项

### P2-1: smoke-queue 未覆盖 Guard/Fallback/401 场景

- **位置**: `scripts/smoke-queue.js`
- **问题**: Sprint 4.4D 引入了 Guard NO_RETRY 和 401 fail closed 两条新路径，但 smoke-queue 仍为 Sprint 4.2 的 8 个 happy path 测试。
- **影响**: 新路径无自动化验证，后续重构有回归风险。
- **建议**: 
  - Guard 场景：设 `MODEL_PROVIDER=lmstudio` 不设 ALLOW → 验证 review turns 标记 `failed`
  - Fallback 场景：设 `MODEL_PROVIDER=openai_compatible` + `MODEL_TIMEOUT_MS=1` + 无效 URL → 验证 fallback mock + warn 日志
  - 401 场景：适合 integration test（需 HTTP mock），可延后

### P2-2: lmstudio 仍有 checkBudget/checkCircuit（继承自 4.4B P2-1）

- **位置**: `provider-adapter.js:157-158`
- **合同**: Section 4.3 — "Circuit breaker 仅适用于 openai_compatible"
- **状态**: 4.4D 未修改 provider-adapter.js，此偏差已继承 3 个 Sprint（4.4B → 4.4C → 4.4D）
- **建议**: 下一个 Sprint 修复，或随 BullMQ 迁移一并处理

### P2-3: NO_RETRY 前缀在 processNext 日志中可见

- **位置**: `queue.service.ts:79`
- **代码**: `this.logger.error(\`Failed (no retry): ${job.type} — ${msg.replace('NO_RETRY:', '')}\`)`
- **问题**: `.replace('NO_RETRY:', '')` 仅替换第一个匹配。如果原始错误消息中包含 `NO_RETRY:` 子串（极端情况），不会被清理。
- **影响**: 极低——原始错误消息（GUARD/API HTTP）不含 `NO_RETRY:` 子串。
- **建议**: 可用 `msg.slice('NO_RETRY:'.length)` 替代 `.replace()`，语义更清晰。

---

## Sprint 4.4C P2 闭环追踪

| 编号 | 描述 | Sprint 4.4D 状态 |
|------|------|-----------------|
| P2-1 | 双重 require 冗余 | ✅ **关闭** — 提取为 `adapterPath` 常量（line 182），单一 require |
| P2-2 | 配置错误触发无效 retry | ✅ **关闭** — NO_RETRY 机制，guard 错误立即 failed |
| P2-3 | Fallback mock 与 default mock 不可区分 | ✅ **部分关闭** — guard/auth 失败时 turn status = `'failed'`（区别于 `'completed'`） |
| P2-4 | 401 错误触发 fallback（合同偏差） | ✅ **关闭** — 401/403 → NO_RETRY → fail closed |
| P2-5 | lmstudio checkBudget/checkCircuit | ❌ 未闭环（继承第 3 个 Sprint） |
| P2-6 | .env.example 未更新 | ✅ **关闭** — 全面更新，9 个变量 + 安全说明 |
| P2-7 | smoke-queue 未扩展 | ❌ 未闭环 — 仍为 8 个 happy path 测试 |

**4.4C 的 7 项 P2 中关闭了 5 项（P2-1/2/3/4/6），剩余 2 项（P2-5/7）延后。**

---

## 代码变更统计

### queue.service.ts（296 → 320 行，+24 行）

| 区域 | 变更类型 | 行范围 |
|------|---------|--------|
| `processNext()` catch 块 | 重写：新增 NO_RETRY 分支 | 73-91 |
| `executeAgentTurn()` adapter 引入 | 重构：提取 `adapterPath` 常量 | 182-183 |
| `executeAgentTurn()` guard catch | 扩展：+ReviewTurn failed +NO_RETRY | 186-197 |
| `executeAgentTurn()` runtime catch | 扩展：+401/403 检查 +Bearer 脱敏 +ReviewTurn failed +NO_RETRY | 199-216 |

### .env.example（29 → 52 行，+23 行）

| 变更 | 说明 |
|------|------|
| 新增 AI Model Provider 区块标题 | `# ── AI Model Provider ──` |
| 新增 7 个变量 | MODEL_BASE_URL / MODEL_NAME / MODEL_API_KEY / MODEL_TIMEOUT_MS / MODEL_MAX_TOKENS / MODEL_BUDGET_LIMIT / MODEL_DAILY_CALL_LIMIT |
| 新增安全说明 | "WARNING: Never commit real API keys to Git" |
| 移除 3 个旧变量 | ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL / OPENAI_API_KEY / ANTHROPIC_API_KEY |
| MINIO 凭证 | 值已部分脱敏 |

---

## 错误处理架构评估

```
executeAgentTurn()
  │
  ├─ getProvider() ──── Guard error
  │                       │
  │                       ├── logger.error("Provider config error (no retry)")
  │                       ├── ReviewTurn.status = 'failed'
  │                       └── throw NO_RETRY → processNext → job.failed (no retry)
  │
  └─ provider.run() ─── Runtime error
                          │
                          ├── HTTP 401/403?
                          │     ├── logger.error("Auth error (no fallback)") [Bearer ***]
                          │     ├── ReviewTurn.status = 'failed'
                          │     └── throw NO_RETRY → processNext → job.failed (no retry)
                          │
                          └── Other (5xx/timeout/parse/circuit/budget)
                                ├── logger.warn("[Fallback] ... → mock, reason: ...")
                                ├── result = mockProvider(roleCode)
                                └── write Opinion → ReviewTurn.status = 'completed'
```

三层分流设计清晰，每一层有明确的错误类型判断、日志级别选择（error vs warn）、fallback 策略（无 vs mock）、retry 策略（NO_RETRY vs 正常 retry）。

---

## 总结

Sprint 4.4D 是一次精准的安全加固，针对性地关闭了 4.4C 遗留的 5 项 P2：

| 修复项 | 效果 |
|--------|------|
| 401/403 fail closed | 认证错误不再静默降级到 mock |
| NO_RETRY 机制 | Guard/auth 错误立即失败，不浪费 retry 周期 |
| Bearer token 脱敏 | 防御性正则，即使错误消息格式变化也不泄漏 |
| ReviewTurn.status = 'failed' | Guard/auth 失败有 DB 记录，meeting.complete 正确统计 |
| .env.example 全面更新 | 新用户可发现所有可用变量 + 安全说明 |

**建议后续**：补充 smoke-queue Guard/Fallback 场景测试（P2-1），修复 lmstudio circuit breaker 偏差（P2-2）。Provider 安全机制已就绪，可进入单次受控 OpenAI-compatible 实测阶段。
