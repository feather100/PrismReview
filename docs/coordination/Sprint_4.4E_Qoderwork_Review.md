# Sprint 4.4E OpenAI-compatible Standalone Spike — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  
> 审查对象：`docs/coordination/Sprint_4.4E_OpenAI_Compatible_Spike_Backend.md`（spike 报告）  
> 交叉验证：`scripts/spike-provider-guard.js`（69 行）、`scripts/provider-adapter.js`（232 行）、`queue.service.ts`（320 行）、`reviews.gateway.ts`、`reviews.service.ts`、`.env.example`

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 4.4E 是一次纯验证 Sprint——零代码变更，仅执行了现有的 `spike-provider-guard.js` 脚本并记录了 Guard 行为。Spike 在 `MODEL_PROVIDER=openai_compatible` + `ALLOW_EXTERNAL_MODEL_CALLS=true` + `MODEL_API_KEY` 未设置的条件下，验证了 Guard 正确拦截并 fail closed。主链路文件（queue.service.ts、gateway、service、controller、前端、schema）与 Sprint 4.4D 完全一致，零修改。默认 mock 路径不受影响。

---

## 1. 是否只有 standalone spike，未接 queue/main chain/SSE/frontend

**结论：✅ 纯 standalone spike，零代码变更。**

### 1.1 文件变更

Backend doc 全文未列出"修改文件"章节。交叉验证确认：

| 文件 | Sprint 4.4D | Sprint 4.4E | 变更 |
|------|-------------|-------------|------|
| `queue.service.ts` | 320 行 | 320 行 | ❌ 未改 |
| `provider-adapter.js` | 232 行 | 232 行 | ❌ 未改（仍标注 Sprint 4.4B） |
| `spike-provider-guard.js` | 69 行 | 69 行 | ❌ 未改（仍标注 Sprint 4.4B） |
| `reviews.gateway.ts` | 未改 | 未改 | ✅ |
| `reviews.service.ts` | 未改 | 未改 | ✅ |
| `reviews.controller.ts` | 未改 | 未改 | ✅ |
| `MeetingPage.tsx` | 未改 | 未改 | ✅ |
| `schema.prisma` | 未改 | 未改 | ✅ |
| `.env.example` | 52 行 | 52 行 | ❌ 未改 |

### 1.2 Spike 执行方式

Sprint 4.4E 的验证通过运行已有脚本完成：

```
node scripts/spike-provider-guard.js --role CTO
```

该脚本是 Sprint 4.4B 创建的 standalone 工具，仅通过 `require('./provider-adapter')` 加载 adapter，不与 NestJS 应用有任何交互。

### 1.3 依赖关系

```
spike-provider-guard.js (standalone)
  └── require('./provider-adapter')  → getProvider() → GUARD throw

queue.service.ts (main chain)
  └── require(adapterPath)           → getProvider() → mock (default)

两者物理隔离，零交互。
```

**Sprint 4.4E 的 spike 完全独立于主链路，不影响任何运行中的服务。**

---

## 2. 是否没有 API Key 泄漏到代码、文档、日志、测试输出

**结论：✅ 四禁合规。**

### 2.1 代码

| 文件 | API Key 引用 | 状态 |
|------|-------------|------|
| `spike-provider-guard.js:31` | `process.env.MODEL_API_KEY ? '***' + slice(-4) : '(unset)'` | ✅ 仅 env 读取 + 遮罩 |
| `provider-adapter.js:36` | `process.env.MODEL_API_KEY \|\| ''` | ✅ 仅 env 读取 |
| `queue.service.ts` | 无引用 | ✅ |

### 2.2 文档

Backend doc Section 2 输出：

```
MODEL_API_KEY: (unset)
```

API Key 未设置，显示 `(unset)`。✅

Backend doc Section 4 "如何完成真实调用" 中的示例：

```powershell
$env:MODEL_API_KEY="sk-..."  # 本地设置，不进 Git
```

使用 `sk-...` 占位符，无真实 Key。✅

### 2.3 日志

Spike 脚本 line 31 的遮罩逻辑：

```javascript
console.log(`   MODEL_API_KEY: ${process.env.MODEL_API_KEY ? '***' + process.env.MODEL_API_KEY.slice(-4) : '(unset)'}`);
```

即使设置了真实 Key，也只输出 `***` + 最后 4 字符。✅

### 2.4 测试输出

Spike 输出（Backend doc Section 2）：

```
MODEL_API_KEY: (unset)
Status: FAILED — "MODEL PROVIDER GUARD: openai_compatible requires MODEL_API_KEY."
```

Guard 错误消息不含 Key 值，测试输出不含 Key。✅

### 2.5 Git

`.env` 在 `.gitignore` 中（line 12-14）。Backend doc Section 4 明确提醒："仅设于本地环境变量，不写入任何文件"。✅

---

## 3. 401/403 是否 fail closed，不 fallback mock

**结论：⚠️ 本次 spike 未验证 401/403 场景（API Key 未设置，Guard 在 HTTP 调用前拦截）。**

### 3.1 本次 spike 范围

Spike 在 `MODEL_API_KEY` 未设置的条件下运行。`getProvider()` 在 factory 阶段即拦截（`provider-adapter.js:221-223`），不会到达 `provider.run()` → `callOpenAICompatible()` → HTTP 请求。因此 401/403 场景不可能在本次 spike 中触发。

```
getProvider()
  → cfg.apiKey = '' (未设置)
  → throw "MODEL PROVIDER GUARD: openai_compatible requires MODEL_API_KEY"
  → spike catch → "✅ Guard works as expected"
  → 不会到达 HTTP 调用层
```

### 3.2 401/403 fail closed 已有验证

401/403 fail closed 机制在 `queue.service.ts:203-211`（Sprint 4.4D）中实现：

```typescript
if (err.message.includes('HTTP 401') || err.message.includes('HTTP 403')) {
  this.logger.error(`Auth error (no fallback): ${err.message.replace(/Bearer [a-zA-Z0-9._-]+/g, 'Bearer ***')}`);
  await this.prisma.reviewTurn.update({
    where: { id: reviewTurn.id },
    data: { status: 'failed', completedAt: new Date() },
  });
  throw new Error('NO_RETRY:' + err.message);
}
```

该机制已通过 Sprint 4.4D 复审（Gate: Go）。

### 3.3 Standalone spike 的局限

`spike-provider-guard.js` 不包含 401/403 处理逻辑——它只是一个简单的 try/catch 脚本：

```javascript
// spike-provider-guard.js:54-65
} catch (err) {
  if (err.message.includes('GUARD') || err.message.includes('Unsupported') || err.message.includes('CIRCUIT')) {
    console.log('\n✅ Guard works as expected.');
  } else {
    console.log('\n❌ Unexpected error — should not happen.');
    process.exit(1);
  }
}
```

如果真实 API 调用返回 401，spike 会进入 `else` 分支并 `process.exit(1)`（标记为"Unexpected error"）。这是合理的——spike 脚本不负责 fallback 逻辑，401/403 fail closed 由 queue.service.ts 在集成层处理。

**401/403 fail closed 已由 Sprint 4.4D 实现并复审通过。本次 spike 验证了更前置的 Guard 层（API Key 缺失拦截），是互补验证而非重复验证。**

---

## 4. 是否只做单次/极少量调用，无批量成本风险

**结论：✅ 零次外部调用（Guard 拦截）。**

本次 spike 的实际执行路径：

```
spike-provider-guard.js
  → getProvider()
    → MODEL_PROVIDER=openai_compatible, ALLOW=true, API_KEY=unset
    → throw GUARD
  → catch → print "Guard works as expected"
  → process.exit(0)
```

**零次 HTTP 请求发出，零成本产生。**

即使设置了真实 API Key，spike 脚本也只执行单次 `provider.run(roleCode, proposal)` 调用（line 40），不会循环、不会批量。单次调用的成本估算：

```
tokens: ~200 prompt + ~100 completion (DeepSeek-V4-Flash)
cost: 200 × $0.000001 + 100 × $0.000003 = $0.0005
```

远低于 `MODEL_BUDGET_LIMIT` 默认值 $0.10。✅

---

## 5. 是否记录 provider/model/duration/result/tokens/fallback 状态

**结论：✅ 成功路径记录完整（本次 spike 走了失败路径）。**

### 5.1 成功路径输出（spike-provider-guard.js:43-53）

```javascript
console.log(`⏱  ${elapsed}ms`);
console.log(`   Provider:  ${result.provider || provider.name}`);
console.log(`   Model:     ${result.model || 'N/A'}`);
console.log(`   Status:    success`);
console.log(`   RiskLevel: ${result.riskLevel}`);
console.log(`   Dimension: ${result.dimension}`);
console.log(`   Confidence: ${result.confidenceScore}`);
console.log(`   Issue:     ${result.issue.substring(0, 80)}...`);
console.log('\n=== Full Result ===');
console.log(JSON.stringify(result, null, 2));
```

| 记录项 | 字段 | 验证 |
|--------|------|------|
| provider | `result.provider` / `provider.name` | ✅ |
| model | `result.model` | ✅ |
| duration | `${elapsed}ms` | ✅ |
| result | `Status: success` + `riskLevel` + `dimension` + `confidenceScore` | ✅ |
| tokens | `body.usage` → `estimateCost()` 内部计算 | ⚠️ 不直接输出 token 数 |
| fallback | 不适用（spike 无 fallback 逻辑） | — |

### 5.2 失败路径输出（本次 spike）

```javascript
console.log(`⏱  ${elapsed}ms`);
console.log(`   Status:    FAILED`);
console.log(`   Error:     ${err.message}`);
```

记录了 elapsed 时间和完整错误消息。✅

### 5.3 缺失项

- **Token 用量**: `estimateCost()` 在 `provider-adapter.js:74-78` 内部计算并累加到 `totalCost`，但 spike 脚本不输出 token 数和成本估算。
- **Fallback 状态**: spike 脚本不执行 fallback（只 try/catch 一次），不适用。

**provider/model/duration/result 在成功路径记录完整。Token 用量和成本估算仅在 adapter 内部计算，未输出到 spike 控制台。**

---

## 6. 默认 mock 路径是否仍不受影响

**结论：✅ 不受影响。**

### 6.1 环境隔离

Spike 通过临时环境变量运行，不修改任何持久化配置：

```powershell
# Spike 临时设置（PowerShell session 级别）
$env:MODEL_PROVIDER="openai_compatible"
$env:ALLOW_EXTERNAL_MODEL_CALLS="true"
# MODEL_API_KEY 未设置

node scripts/spike-provider-guard.js
```

`.env` 和 `.env.example` 保持 `MODEL_PROVIDER="mock"` + `ALLOW_EXTERNAL_MODEL_CALLS=false`。✅

### 6.2 主链路验证

| 组件 | 默认行为 | 影响 |
|------|---------|------|
| `queue.service.ts` | `getProvider()` → mock | ✅ 不受影响 |
| `reviews.gateway.ts` | MOCK_AGENT_CONTENT（SSE mock） | ✅ 不受影响 |
| `reviews.service.ts` | MOCK_OPINIONS（Report mock） | ✅ 不受影响 |
| smoke-runtime 31/31 | 默认 mock 环境 | ✅ 不受影响 |
| smoke-queue 8/8 | 默认 mock 环境 | ✅ 不受影响 |
| smoke-sse 5/5 | 默认 mock 环境 | ✅ 不受影响 |

**Spike 执行不修改任何文件、不修改任何持久化配置、不影响默认 mock 路径。**

---

## 7. 是否无 schema/前端/状态机改动

**结论：✅ 均无改动。**

| 文件 | 验证方式 | 状态 |
|------|---------|------|
| `schema.prisma` | 未修改（Backend doc 无提及） | ✅ |
| `MeetingPage.tsx` | import 头一致 | ✅ |
| `useMeetingSSE.ts` | 未修改 | ✅ |
| `reviews.controller.ts` | import 头一致 | ✅ |
| `REVIEWS_STATUS_FLOW` | 未修改（reviews.service.ts:9-19） | ✅ |

Backend doc 全文无任何 schema、前端、状态机相关描述。✅

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。**

---

## P2 可延后项

### P2-1: 本次 spike 仅验证 Guard-blocked 路径，未验证真实调用成功路径

- **问题**: Sprint 4.4E 在 `MODEL_API_KEY` 未设置条件下运行，仅验证了 Guard 拦截行为。真实 API 调用的成功路径（HTTP 请求 → JSON 解析 → result 输出）未在 standalone spike 中验证。
- **影响**: 成功路径的 `provider.run()` → `callOpenAICompatible()` → JSON parse → `normalizeParsed()` 链路未端到端验证。
- **建议**: 后续 spike（或同一 spike 设置 API Key 后重新运行）验证成功路径。确保 `result.provider`、`result.model`、`result.durationMs`、token 用量正确输出。

### P2-2: Spike 脚本不输出 token 用量和成本估算

- **位置**: `spike-provider-guard.js`
- **问题**: `provider-adapter.js` 内部通过 `estimateCost()` 计算成本并累加到 `totalCost`，但 spike 脚本不输出这些信息。
- **影响**: 成功调用时无法直观看到 token 消耗和成本。
- **建议**: 在成功路径添加 token 和成本输出：
  ```javascript
  console.log(`   Tokens:    prompt=${result.tokens?.prompt}, completion=${result.tokens?.completion}`);
  console.log(`   Cost:      $${result.costEstimate?.toFixed(6)}`);
  ```
  注：需在 `callOpenAICompatible()` 返回值中添加 `tokens` 和 `costEstimate` 字段。

### P2-3: ACTIVE_SPRINT.md 未更新至 Sprint 4.4E

- **位置**: `docs/coordination/ACTIVE_SPRINT.md`
- **问题**: 仍显示 "Current Sprint: Sprint 4.4C"，未反映 4.4D 和 4.4E 的进展。
- **影响**: 看板信息与磁盘实际状态不一致。
- **建议**: 更新 ACTIVE_SPRINT.md 反映最新 Sprint 状态。

### P2-4: lmstudio 仍有 checkBudget/checkCircuit（继承自 4.4B）

- **位置**: `provider-adapter.js:157-158`
- **状态**: 已继承 4 个 Sprint（4.4B → 4.4C → 4.4D → 4.4E），未修复
- **建议**: 随 BullMQ 迁移一并处理

---

## Spike 完整性评估

| 维度 | 评分 | 说明 |
|------|------|------|
| Guard 验证 | 5/5 | API Key 缺失 → GUARD throw → 正确拦截 |
| API Key 安全 | 5/5 | 代码/文档/日志/输出均无泄漏 |
| 成本控制 | 5/5 | 零次外部调用，零成本 |
| 主链路隔离 | 5/5 | 零文件变更，零配置修改 |
| 真实调用验证 | 2/5 | 仅验证 Guard-blocked 路径，未验证成功路径 |
| 输出完整性 | 4/5 | 成功路径有 provider/model/duration，缺 tokens/cost |

**综合评分：4.3/5**

---

## 总结

Sprint 4.4E 是一次轻量级的 Guard 验证 spike，目标明确——确认 `openai_compatible` provider 在缺少 API Key 时正确 fail closed。该目标已达成：

1. Guard 正确拦截 `MODEL_API_KEY` 缺失 ✅
2. API Key 未出现在任何输出中 ✅
3. 零次外部调用，零成本 ✅
4. 未 fallback 到 mock ✅
5. 主链路零影响 ✅

Sprint 4.4E 的意义在于：在设置真实 API Key 进行实际调用之前，先确认安全机制（Guard）工作正常。这是一次"安全闸验证"而非"功能验证"。真实调用的功能验证（HTTP → JSON → result）可在后续 spike 中补充（P2-1）。

Provider Guard 安全机制已经过 4 个 Sprint 的迭代验证（4.4A 合同 → 4.4B standalone → 4.4C 集成 → 4.4D 加固 → 4.4E spike），可以放心进行受控的真实 API 调用测试。
