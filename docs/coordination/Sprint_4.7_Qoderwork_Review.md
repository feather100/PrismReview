# Sprint 4.7 Provider Safety Closeout + Fast Gate Protocol — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）
> 审查日期：2026-07-09
> 审查模式：快速 Gate（只查 P0/P1，证据 ≤ 5 条）
> 审查对象：`docs/coordination/Sprint_4.7_Provider_Safety_Closeout_Backend.md`
> 交叉验证：`scripts/provider-adapter.js`、`scripts/smoke-queue.js`、`ACTIVE_SPRINT.md`、`AGENT_COORDINATION_PROTOCOL.md`、`queue.service.ts`、`scripts/smoke-provider-robustness.js`

---

## Gate: **Go** ✅

无 P0 / P1 阻塞项。

---

## 证据（5 条）

### 证据 1 — 零真实外部调用 + Guard fail closed 完整覆盖 ✅

`provider-adapter.js` 变更仅限 `lmstudioProvider`（lines 163-173）：移除了 `checkBudget()` / `checkCircuit()` 两行调用。LM Studio 是本地进程，零外部成本，此修复对齐合同 Section 4.3（"Circuit breaker 仅适用于 openai_compatible"）。

`getProvider()` Guard 矩阵（lines 205-235）不变：

| 场景 | 行为 | 验证 |
|------|------|------|
| `MODEL_PROVIDER=lmstudio` + `ALLOW_EXTERNAL_MODEL_CALLS` 未设 | throw GUARD | ✅ |
| `MODEL_PROVIDER=openai_compatible` + ALLOW 未设 | throw GUARD | ✅ |
| `MODEL_PROVIDER=openai_compatible` + ALLOW=true + API Key 未设 | throw GUARD (MODEL_API_KEY) | ✅ |

`smoke-queue.js` 新增 6 个 Guard 测试（lines 87-113），覆盖上述三种 throw 场景 + default mock + runtime fallback + mock CFO fallback。`smoke-provider-robustness.js` 14/14 无回归。

### 证据 2 — 401/403 不 fallback + 普通 runtime error fallback mock + warn ✅

`queue.service.ts` 未做任何改动（320 行与 Sprint 4.4D 一致）。三层错误分流完整保持：

- Guard 错误 → `NO_RETRY` + `reviewTurn.status = 'failed'`（lines 186-197）
- HTTP 401/403 → `NO_RETRY` + `reviewTurn.status = 'failed'`（lines 204-211）
- 运行时错误 → `logger.warn('[Fallback]')` + `mockProvider(roleCode)`（lines 212-215）

### 证据 3 — 默认 mock / queue / SSE / provider robustness 无回归 ✅

| 测试套件 | 结果 |
|---------|------|
| smoke-runtime | 31/31 ✅ |
| smoke-queue | 14/14 ✅（8 原有 + 6 新增 Guard） |
| smoke-sse | 5/5 ✅ |
| smoke-provider-robustness | 14/14 ✅（已验证） |
| tsc | 0 errors ✅ |

`reviews.gateway.ts`、`reviews.service.ts`、`reviews.controller.ts`、`schema.prisma`、前端文件均零改动。

### 证据 4 — ACTIVE_SPRINT.md 已修正 ✅

Header 更新为 `Current Sprint: Sprint 4.7`，Phase 为 "Provider Safety Closeout + Fast Gate Protocol"。历史 Gate 记录清理为简洁表格：

```
| Sprint | 状态 |
| 4.0-4.6 | 已通过 qoderwork 复审（Gate 结论均记录在各自复审文档中） |
| 4.7（当前） | In Progress |
```

Sprint 4.6 P2-3（Gate 区域标签停留在 4.4C）已关闭。

### 证据 5 — 快速 Gate 模式写入协作协议且不破坏原深度审计流程 ✅

`AGENT_COORDINATION_PROTOCOL.md` 新增 §7（lines 161-209），定义了：

- **5 项触发条件**（§7.1）：不改 schema、不改状态机、不涉及真实 LLM 首次接入、不改前端主页面、不引入新外部依赖。任一不满足 → 退回标准流程（§2）。
- **简化流程**（§7.2）：reasonix → qoderwork（P0/P1，≤5 条证据）→ Gate。
- **Checklist**（§7.3）：4 项确认项。
- **反例表**（§7.4）：4 种不符合快速 Gate 的场景。

标准流程（§2）、红线（§5）、Gate 标准（§6）均未被修改。§7 作为补充而非替代，深度审计流程完整保持。✅

---

## P0 阻塞项

无。

## P1 建议项

无。

## P2 可延后项

| # | 描述 | 状态 |
|---|------|------|
| P2-1 | 真实 API 调用成功路径仍未端到端验证 | 继承自 4.4E |
| P2-2 | spike 脚本不输出 token 用量 / 成本估算 | 继承自 4.4E |

**已关闭的 P2**（本 Sprint）：
- smoke-queue Guard/Fallback 覆盖 ✅（新增 6 个 Guard 测试，继承自 4.4C P2-7，历时 4 个 Sprint 终于关闭）
- lmstudio checkBudget/checkCircuit 偏差 ✅（移除调用，继承自 4.4B P2-1，历时 5 个 Sprint 终于关闭）
- ACTIVE_SPRINT.md Gate 区域标签不一致 ✅（清理并更新）

---

## 变更统计

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `scripts/provider-adapter.js` | 修改 | lmstudioProvider 移除 checkBudget/checkCircuit（-2 行） |
| `scripts/smoke-queue.js` | 修改 | 新增 6 个 Guard 测试（80 → 154 行，+74 行） |
| `docs/coordination/ACTIVE_SPRINT.md` | 修改 | 更新至 Sprint 4.7，清理历史 Gate 记录（183 → 56 行） |
| `docs/coordination/AGENT_COORDINATION_PROTOCOL.md` | 修改 | 新增 §7 快速 Gate 模式（+48 行） |

**零主链路代码变更** — queue.service.ts、gateway、service、controller、schema、前端均未修改。
