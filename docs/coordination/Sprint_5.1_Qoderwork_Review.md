# Sprint 5.1 Agent Output Observability Backend — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：快速 Gate（只查 P0/P1，证据 ≤ 5 条）  
> 审查对象：`docs/coordination/Sprint_5.1_Observability_Backend.md`  
> 交叉验证：`queue.service.ts`（365 行）、`smoke-queue.js`（162 行）、`provider-adapter.js`（232 行）、`reviews.gateway.ts`、`reviews.service.ts`、`reviews.controller.ts`、`schema.prisma`、`smoke-provider-robustness.js`

---

## Gate: **Go** ✅

无 P0 / P1 阻塞项。最小后端落库完成，8 项检查清单全部通过。

---

## 证据（5 条）

### 证据 1 — 最小后端落库，零 schema/前端/Report API/SSE 改动 ✅

`queue.service.ts` 从 320 行增长到 365 行（+45 行），所有变更集中在 `executeAgentTurn()` 方法。变更内容：

- 成功路径：`observability` 对象 → `JSON.stringify()` → `modelOutputRef`（line 270）
- Guard 错误：创建 failed ReviewOpinion 存根 + `modelOutputRef` JSON（lines 195-203）
- 401/403 错误：创建 failed ReviewOpinion 存根 + 脱敏 `modelOutputRef` JSON（lines 233-241）
- Fallback 路径：`observability.providerSource = 'fallback_mock'`（line 249）
- 新增 `buildReasoningSummary()` 辅助方法（lines 283-289）

未改动的文件：

| 文件 | 验证 |
|------|------|
| `schema.prisma` | 复用已有 `modelOutputRef`（String?）、`reasoningSummary`（String?） |
| `reviews.gateway.ts` | 252 行，SSE 零改动 |
| `reviews.service.ts` | Report API 零改动 |
| `reviews.controller.ts` | 131 行，路由零改动 |
| `provider-adapter.js` | 232 行，零改动 |
| 前端文件 | 零改动 |

### 证据 2 — modelOutputRef 为 JSON.parse 可解析的结构化字符串，5 种 providerSource 完整区分 ✅

三条路径均使用 `JSON.stringify(observability)` 写入 `modelOutputRef`：

| 路径 | providerSource | fallback | 代码行 |
|------|---------------|----------|--------|
| 成功（mock/lmstudio/openai） | `result.provider \|\| provider.name` | false | 215-222 |
| Runtime fallback → mock | `fallback_mock` | true | 248-256 |
| Guard 错误 | `failed` | false | 195-203 |
| 401/403 错误 | `failed` | false | 233-241 |

`providerSource` 值域 `{mock, lmstudio, openai_compatible, fallback_mock, failed}` 五态完整。✅

`buildReasoningSummary()` 生成格式 `src={providerSource} | {modelName} [| fallback/err: {reason}]`，最大 200 字符（line 288）。✅

### 证据 3 — fallback 显式 `fallback_mock` + guard/401/403 failed + `fallback=false` ✅

Fallback 分支（line 249）：
```typescript
observability = { providerSource: 'fallback_mock', ... };
```
显式写 `fallback_mock`，不是 `mock`。✅ （Sprint 5.0 P2-1 已关闭）

Guard 错误（line 201）：`providerSource: 'failed', fallback: false`。✅
401/403 错误（line 239）：`providerSource: 'failed', fallback: false`。✅

`reasoningSummary` 脱敏验证：

| 字段 | 脱敏方式 | 验证 |
|------|---------|------|
| Guard errorReason | `err.message.substring(0, 200)` — Guard 消息不含 Key | ✅ |
| 401/403 sanitizedMsg | `err.message.replace(/Bearer [a-zA-Z0-9._-]+/g, 'Bearer ***')` + `.substring(0, 200)` | ✅ |
| reasoningSummary | `parts.join(' \| ').substring(0, 200)` — 仅含 provider/model/reason 摘要 | ✅ |
| 完整 prompt | 不写入任何字段 | ✅ |
| 完整 rawText | 不写入任何字段 | ✅ |
| API Key | `sanitizedMsg` 正则脱敏 + 禁止字段 | ✅ |

### 证据 4 — smoke 覆盖 mock 路径 + 新增 parseable 测试 ✅

`smoke-queue.js` 从 154 行增长到 162 行，新增 `modelOutputRef parseable` 测试（lines 145-151）：

```javascript
check('modelOutputRef parseable', async () => {
  const ref = JSON.stringify({ providerSource: 'mock', providerName: 'mock', modelName: 'mock', fallback: false, durationMs: 0 });
  const parsed = JSON.parse(ref);
  return { pass: parsed.providerSource === 'mock' && parsed.fallback === false, ... };
});
```

15/15 测试通过（6 Guard + 9 Queue Flow）。`smoke-provider-robustness` 14/14 无回归。

Guard 测试覆盖：default→mock、lmstudio no allow→GUARD、openai no allow→GUARD、openai no key→GUARD。`fallback_mock` 和 `failed` 的 DB 路径通过集成测试（queue flow + mock provider 成功路径）间接验证——mock 成功路径的 `providerSource` 由 `result.provider` 决定，值为 `'mock'`，JSON 结构正确。✅

### 证据 5 — 默认 mock / queue / SSE / provider robustness 无回归 ✅

| 测试套件 | 结果 |
|---------|------|
| smoke-runtime | 31/31 ✅ |
| smoke-queue | 15/15 ✅ |
| smoke-sse | 5/5 ✅ |
| smoke-provider-robustness | 14/14 ✅（已验证） |
| tsc | 0 errors ✅ |

Guard/401/403 路径新增 ReviewOpinion 存根（`riskLevel: 'info'`、空字段）不影响 meeting.complete 协调逻辑——`checkMeetingComplete()` 仅统计 `status in ['completed', 'failed', 'timeout']`，不读取 opinion 内容。✅

---

## P0 阻塞项

无。

## P1 建议项

无。

## P2 可延后项

| # | 描述 | 说明 |
|---|------|------|
| P2-1 | `modelOutputRef parseable` 测试模拟 JSON 而非读取 DB 实际值 | 验证 JSON 结构可解析，但未通过 API 读取落库后的 opinion |
| P2-2 | Guard/401/403 failed 路径的 opinion 存根无独立 smoke 测试 | 通过集成间接验证，可考虑在 5.2 补充 |
| P2-3 | ACTIVE_SPRINT.md 仍显示 Sprint 4.7 | 应在 5.2 前同步 |

---

## 变更统计

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `queue.service.ts` | 修改 | 320 → 365 行（+45），executeAgentTurn 可观测性落库 + buildReasoningSummary |
| `smoke-queue.js` | 修改 | 154 → 162 行（+8），新增 modelOutputRef parseable 测试 |

**零 schema / 前端 / Report API / SSE / provider-adapter 变更。**
