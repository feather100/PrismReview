# Sprint 9.5a — P1 多轮地基（修 9.4 review P2-1~P2-4）· 实现记录（Backend）

> 标准 Gate · Owner: workbuddy-coder · 基线 main = `7a8b4e6` · 不提交（待 Codex 交 `workbuddy-review` 复审）
>
> 本 Sprint 让 9.4 的单轮脊柱能在**多轮语义**下正确运转，为 9.5b（round-2 debater + 多轮循环）打地基。
> **本 Sprint 不加 round-2 / continue_debate / 多轮循环**（9.5b 范围）。

---

## 0. 三连查（开工强制）

| 项 | 期望 | 实际 |
|----|------|------|
| `git rev-parse --show-toplevel` | `D:/workspace/PrismReview` | ✓ |
| `git remote -v` | `origin = https://github.com/feather100/PrismReview.git` | ✓ |
| `git status --short` | clean | ✓（基线 `7a8b4e6`） |
| `git pull --ff-only origin main` | Already up to date | ✓ |

---

## 1. 4 条 P2 修正方案与落点

### P2-1：`round` 贯通
**问题**：`agent.turn.execute` 派发 payload 不带 `round`；`executeAgentTurn` 用 `payload.round ?? 1` 静默回退；`reviewTurn.create` 写死 `round: 1`。round-2 会全部错发 round=1 且语义元组幂等键冲突。

**改法**（逐文件）：
- `review-orchestrator.ts` `nodeRunning`：派发 `review.start` 时显式携带 `round: state.round`（= `review.currentRound`）。
- `queue.service.ts` `executeReviewStart`：从 payload 读 `round`（回退顺序 `payload.round ?? review.currentRound`，二者均为真实 round 值，非写死 1），传播到每个 `agent.turn.execute` payload。
- `queue.service.ts` `executeAgentTurn`：**强制要求 `payload.round`**——缺失/非法（`typeof !== 'number'` / 非整数 / `<1`）立即 `throw new Error('NO_RETRY: ...')`，**不静默回退 1**；`reviewTurn.create` 的 `round` 与 `idempotencyKey` 均取 `payload.round`。
- `idempotency.ts` 的 `findExistingTerminalTurn` 按收到的 `round` 查询（语义元组，覆盖 3/4 段键，与 9.4 P2-1 指令一致）。

### P2-2：`minRounds` 强制校验
**问题**：`hard-gates.ts`/`moderator.ts` 定义了 `minRounds` 但 `decide()` 未强制；round-1 summarized 后即使 `min_rounds>1` 也会直接 converge→completed。

**改法**（`moderator.ts` `decide()`）：在硬闸检查（maxRounds/maxTurns/maxTokens/maxCost/convergence）**之后**新增分支：
```
else if (round < gates.minRounds) {
  decisionType = 'advance_round';
  reasoning = `round=${round} < minRounds=${gates.minRounds}: minRounds not met → must continue ...`;
}
```
- `min_rounds=1`（默认）→ round=1 ≥ 1 → 允许 converge（**9.4 单轮行为不变**）。
- `min_rounds>1` → round-1 不进 completed（返回 `advance_round`，脊柱在 `handleTurnsComplete` 保持 `summarized`，9.5b 接管派发 round-2）。

### P2-3：Graph 条件边真做状态路由
**问题**：`graph.edges` 声明式但 `review-orchestrator.ts` 是命令式；`summarized` 条件边恒返回 `completed`（死代码）。

**改法**：
- 新增模块级纯函数 `routeAfterSummarized(type): 'completed' | 'aborted' | 'summarized'`（P2-3 注释块说明 9.5a 三态映射：`converge`/`terminate_proposal`→`completed`、`force_stop`→`aborted`、`advance_round`/`continue_debate`→`summarized`；留 `continue_debate → running(r2)` 空分支，9.5b 填）。
- `buildGraph()` 移除硬编码 `summarized → completed` 静态边；`summarized` 条件边改为 `route: (s) => routeAfterSummarized(s.lastDecisionType ?? 'converge')`。
- `handleTurnsComplete` 记录 `state.lastDecisionType = decision.decisionType`，并用 `routeAfterSummarized(decision.decisionType)` 决定下一节点（非硬编码）。`advance_round`/`continue_debate` 下保持 `summarized`（不进 completed）。

### P2-4：`ReviewStatus` 加 `interrupted` / `archived`
**问题**：`graph-runtime.ts` 的 `ReviewStatus` = 7 值规范集，缺 `interrupted`/`archived`（9.3 物理枚举已含）。

**改法**（`graph-runtime.ts`）：
- `ReviewStatus` 联合类型补 `| 'interrupted' | 'archived'`（§1.1 补充保留态注释）。
- `TERMINAL_STATUSES` 补 `'archived'`（按 9.3 物理枚举语义归为终态）；**刻意不放入 `interrupted`**（HITL 暂停，可恢复 → `running`）。
- `ReviewState.lastDecisionType?` 已存在（供条件边读取）。无运行期 status switch 需补（既有 `REVIEW_STATUS_FLOW` 已含两值，见 `reviews.service.ts`）。

---

## 2. 验证证据

### 2.1 定向验证脚本（真实实例，15/15）
`apps/api/scripts/verify-9.5a-multiround-foundation.js`（gitignored，同 9.4 约定）通过**真实 Prisma + 真实 QueueService / ReviewOrchestrator / MockModerator** 实例断言：

| # | 断言 | 结果 |
|---|------|------|
| P2-1a.1 | round=2 dispatch 写 `reviewTurn.round=2` + `idempotencyKey …::2` | PASS |
| P2-1a.2 | round=1 vs round=2 幂等键不同（9.5 不冲突） | PASS |
| P2-1a.3 | 幂等按收到 round 查（round=2 命中 / round=1 不命中） | PASS |
| P2-1b | 缺 round → `NO_RETRY` 拒绝，未建 turn | PASS |
| P2-2.1 | round=1 < minRounds=2 → `advance_round`（不提前 converge） | PASS |
| P2-2.2 | round=1 ≥ minRounds=1 → `converge`（回归保留） | PASS |
| P2-2.3 | round=2 < minRounds=3 → `advance_round`（多轮闸） | PASS |
| P2-3.1 | `summarized` 条件边按 decisionType 路由（converge→completed / force_stop→aborted / advance_round→summarized / continue_debate→summarized） | PASS |
| P2-3.2 | `advance_round` 决策 → review 保持 `summarized`（不进 completed） | PASS |
| P2-3.3 | `converge` 决策 → review 达 `completed`（回归） | PASS |
| P2-4.1 | `archived` 为终态 | PASS |
| P2-4.2 | `interrupted` 非终态（可恢复） | PASS |
| REG.1 | 全链路脊柱达 `completed`（9.4 行为完好） | PASS |
| REG.2 | per-node checkpoint `running→summarized→completed` | PASS |
| REG.3 | `converge` 决策落库 `ruleCheckResult.passed=true` | PASS |

### 2.2 标准 Gate 证据
- `tsc -p apps/api --noEmit` → **exit 0**（0 errors）
- `tsc apps/web --noEmit` → **exit 0**（0 errors）
- `prisma migrate deploy` → **No pending migrations to apply**
- Docker/Postgres 16-alpine 健康（verify + smoke 均实时连接成功）
- 密钥扫描 `git grep -nE 'sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]{20,}' -- apps/ scripts/ docs/`：仅命中 `docs/coordination/` 历史脱敏占位符 `sk-xxxxxxxxxxxxxxxx`（非真实 Key、非本次文件）；**本次源码零命中**
- 沙箱约束：无 ts-node/tsx → 直接 `require` `apps/api/dist`（tsc 编译产物）跑真实类；验证脚本 gitignored

### 2.3 回归：standing smoke
- `scripts/smoke-runtime.js` 对运行中 API（含 9.5a 改动）实跑：**31/31 passed, 0 failed**（含 test 11 `POST /reviews/{id}/start` 端到端走新脊柱）——Route A/B 均不破。

---

## 3. 显式声明：未做（9.5b 范围）

以下**故意未实现**，留空分支/声明，越界即 P0：
- ❌ round-2 debate turns 派发逻辑（仅留 `continue_debate → running(r2)` 路由骨架）
- ❌ `continue_debate` Moderator 决策的冲突检测实现（`decide()` 未产生该类型）
- ❌ 多轮 `[running→summarized]*` 循环（9.5b）
- ❌ opinion 校验规则改动
- ❌ 任何 schema 变更（9.5a 不改 schema，`migrate deploy` 仍 up to date）
- ❌ 真 LLM（默认 mock，`max_cost_per_review=0`）、`ModelAdapter`(P2)、`Memory`/`Prompt`(P3)、`Tool`/`HITL`(P4)

---

## 4. 红线核对

| 红线 | 遵守 |
|------|------|
| 标准 Gate（行为变更，协议 §2 + §6.3 证据） | ✓ |
| 默认 mock，不调真实 LLM | ✓（provider-adapter 默认 mock） |
| 不写密钥 | ✓ |
| 不提交 `.env`/`node_modules`/`data`/`.reasonix`/`.workbuddy`/日志 | ✓（验证脚本 gitignored） |
| 不 `--force`；不 git commit | ✓（待 Codex 决定） |
| 不伪造验证证据 | ✓（全部真实实例跑通） |
| 不越界 9.5b | ✓（见 §3） |
| 前端零改动，API 契约保留 | ✓（仅后端编排层；前端未碰） |

---

## 5. 代码改动清单

**编辑（4 源码 + 1 gitignore）**：
- `apps/api/src/modules/reviews/orchestrator/graph-runtime.ts`（P2-4：Status 联合 + TERMINAL_STATUSES）
- `apps/api/src/modules/reviews/orchestrator/moderator.ts`（P2-2：minRounds 强制分支）
- `apps/api/src/modules/reviews/orchestrator/review-orchestrator.ts`（P2-1：round 派发；P2-3：routeAfterSummarized + 条件边 + lastDecisionType）
- `apps/api/src/modules/reviews/queue/queue.service.ts`（P2-1：round 贯通 + 强制校验）
- `.gitignore`（验证脚本通配忽略 `apps/api/scripts/verify-*.js`）

**新增（gitignored，验证用）**：
- `apps/api/scripts/verify-9.5a-multiround-foundation.js`

**未动**：schema.prisma、前端 `apps/web`、API 契约路由。

---

## 6. 给 9.5b 的地基

- `routeAfterSummarized` 已支持 `continue_debate → summarized`（待 9.5b 改为 `→ running(r2)` 派发）。
- `decide()` 的 `advance_round` 分支已就绪，9.5b 只需在 `handleTurnsComplete` 的 `next === 'summarized'` 分支注入 round-2 派发（当前 intentionally 保持 summarized）。
- `ReviewStatus` 已含 `interrupted`/`archived`，HITL 暂停/归档可直接用。
- `round` 已全链路贯通，9.5b 多轮循环可直接复用 `state.round` + `payload.round` 机制，无链断路风险。
