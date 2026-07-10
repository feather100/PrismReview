# Sprint 4.7 — Provider Safety Closeout + Fast Gate Protocol

> 关闭 Provider 安全链路的长期 P2，固化"快速 Gate 模式"。

---

## 1. 修改文件

| 文件 | 变更 |
|---|---|
| `docs/coordination/ACTIVE_SPRINT.md` | 更新为 Sprint 4.7，清理历史 Gate 记录 |
| `docs/coordination/AGENT_COORDINATION_PROTOCOL.md` | 新增 §7 快速 Gate 模式 |
| `scripts/provider-adapter.js` | `lmstudioProvider` 移除 `checkBudget/checkCircuit`（本地无成本） |
| `scripts/smoke-queue.js` | 新增 6 个 Guard 测试 |

## 2. 修复内容

### ACTIVE_SPRINT.md
- 更新为 Sprint 4.7、当前目标、当前输出文档
- 清理 4.0-4.6 历史 Gate 记录（已通过复审，不阻塞）

### 快速 Gate 模式 (§7)
- 小改动/纯测试/纯文档 Sprint 可走快速 Gate
- qoderwork 只查 P0/P1，证据 ≤ 5 条
- 不要求全量三文档
- 触发条件：不改 schema、不改状态机、不接真实 LLM/队列核心

### lmstudio budget/circuit 对齐
- `lmstudioProvider` 不再调用 `checkBudget()`/`checkCircuit()`
- 预算/熔断仅适用于 `openai_compatible`（有外部成本）
- LM Studio 是本地进程，零成本，不需要 budget/circuit

## 3. 验证

```
smoke-runtime:              31/31 ✅
smoke-queue (14, +6 guard): 14/14 ✅
smoke-sse:                   5/5  ✅
smoke-provider-robustness:  14/14 ✅
tsc:                         0 errors ✅
```
