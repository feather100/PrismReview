# Sprint 9.4 — P1 Orchestrator Spine (single-round) · Workbuddy 标准 Gate 复审

- **模式**：标准 Gate（动业务代码：新增 `orchestrator/` 模块 + 编辑 3 service 文件；不动 schema、不动前端）
- **复审对象**：workbuddy-coder 的 9.4 实现（8 orchestrator 文件 + 3 编辑 + verify 脚本 + 文档）
- **基线 main**：`c7158ab`（9.3 Go 入库）
- **复审日期**：2026-07-13
- **复审 agent**：workbuddy-review（独立上下文，未采信 coder 证据文档 / Codex 协调核验；结论全部自查磁盘/git/代码/DB，可重跑项独立重跑）

---

## 0. 三连查记录（开工强制）

| 检查 | 命令 | 结果 |
|---|---|---|
| toplevel | `git rev-parse --show-toplevel` | `D:/workspace/PrismReview` ✓ |
| remote | `git remote -v` | `origin = https://github.com/feather100/PrismReview.git` ✓ |
| status | `git status --short` | 见下 ✓ |
| pull | `git pull --ff-only origin main` | `Already up to date.` ✓ |

`git status --short` 实际范围（恰好等于任务书声明）：

```
 M apps/api/src/modules/reviews/queue/queue.service.ts
 M apps/api/src/modules/reviews/reviews.module.ts
 M apps/api/src/modules/reviews/reviews.service.ts
 M docs/coordination/ACTIVE_SPRINT.md
?? apps/api/scripts/
?? apps/api/src/modules/reviews/orchestrator/
?? docs/coordination/Sprint_9.4_Orchestrator_Spine_Backend.md
```

独立边界确认：
- `git diff --name-only apps/api/prisma/schema.prisma` → **空**（schema 未动）
- `git diff --name-only apps/web` → **空**（前端未动）

---

## 1. 变更范围 + 边界（P0 若违）

- 变更仅上述 7 代码改（8 orchestrator 新建视为 1 个目录 + 3 service 编辑 + 1 verify 脚本）+ 2 文档，无 `.env` / `node_modules` / `data` / `.reasonix` / `.workbuddy` / 日志混入。
- **`schema.prisma` 未动**：`git diff` 空输出；`prisma migrate status` 显示 **3 migrations found / Database schema is up to date**（与 9.3 的迁移数一致，9.4 零迁移）。✓
- **`apps/web` 未动**：`git diff` 空输出。✓
- **未越界 9.5**：见 §3。✓
- **P0 边界全部满足。**

---

## 2. graph runtime 忠实度（Contract §2）

读 `orchestrator/graph-runtime.ts`，TS 类型与 Contract §2 落地对照：

| Contract §2 元素 | 落地 | 判定 |
|---|---|---|
| `Node<S>` | `Node<S extends ReviewState> = (state, ctx) => Promise<Partial<S>>` | ✓ |
| `StaticEdge` / `ConditionalEdge` / `Edge` | 三类型齐全，`ConditionalEdge.route` 取节点 id | ✓ |
| `Graph<S>` | `nodes` / `edges` / `start`（入口 `created`） | ✓ |
| `ReviewState` | reviewId/status/round/currentNodeId/turns/moderatorDecisions/usage/convergenceScore/updatedAt | ✓ |
| `TurnRecord` | turnId/reviewerId(=roleVersionId)/round/phase/status/opinionRef | ✓ |
| `ModeratorDecisionRef` | decisionId/round/decisionType | ✓ |
| `UsageLedger` | totalTokens/totalRounds/turnsByReviewer/totalCost(恒 0) | ✓ |
| `Checkpoint` | id/reviewId/nodeId/stateJson/sequence/createdAt | ✓ |
| `Checkpointer` | save/load 接口 | ✓ |
| `NodeCtx` | logger/checkpointer/queue/prisma + modelAdapter/memoryService/promptService 注入位（P1 undefined） | ✓ |

- `ReviewStatus` 类型 = 7 值规范集 `created | diagnosed | running | summarized | completed | failed | aborted`（与任务书声明一致）。注：`interrupted` / `archived`（9.3 枚举的另 2 值）未纳入——single-round 脊柱不驱动这两态，见 P2-4。
- `TurnStatus` / `TurnPhase` / `ModeratorDecisionType` 与 Contract 一致（`advance_round`/`continue_debate`/`terminate_proposal` 仅作类型保留，逻辑未用，见 §3）。
- 缺类型/猜字段/偏离：无。忠实度 OK。

---

## 3. 幂等覆盖 3/4 段键（指令 1，CRITICAL — P0 若漏）

读 `orchestrator/idempotency.ts`：`findExistingTerminalTurn(prisma, {reviewId, roleVersionId, round})` 按**语义元组**查 `ReviewTurn`（`status in [completed, failed, timeout]`），**不依赖 `idempotencyKey` 字符串相等**。

- 该查询以 `(reviewId, roleVersionId, round)` 为条件，天然命中 9.3 的两种键形态：
  - 3 段键 `${reviewId}::${roleVersionId}::${round}`
  - 4 段键 `${reviewId}::${roleVersionId}::${round}::${N}`（9.3 消歧后缀，72 行）
  因为键字符串里的 `round` 段 === 查询的 `round` 参数，与第 1、2 段无关。只匹配 `== '...::1'` 才会漏 4 段键；本实现不如此。✓
- `ReviewTurn.status` 在 schema 中确为 `String`，注释值含 `timeout`，故 `TERMINAL` 含 `timeout` 合法。✓
- **独立验证**：`verify-9.4-spine.js` 子用例
  - `(a.1)` 同 `(review,rvid,round=1)` 下写入 3 段 `::1` + 4 段 `::1::2` 两条已终态 turn → `findExistingTerminalTurn` 命中（`found=true`）→ **证明 4 段键被覆盖** PASS
  - `(a.2)` `round=2` 已终态 turn 不被 `round=1` 查询命中（`found=false`）→ round 维度生效 PASS
  - `(a.3)` 不同 reviewer 不命中（`found=false`）→ reviewer 维度生效 PASS
- **CRITICAL 验收通过**：幂等覆盖 3/4 段键。

> 潜在 latent 缺口（非 9.4 阻塞，见 P2-1）：派发 payload（`queue.service.ts` `enqueue('agent.turn.execute', …)`）未携带 `round`，`executeAgentTurn` 也只读 `payload.round ?? 1`，且 `reviewTurn.create` 写死 `round: 1`。9.4 单轮恒为 1，语义元组幂等正确；但 `round` 未从派发真正贯通，9.5 round-2 须在 payload + consume 两端补 `round` 传递。

---

## 4. ReviewOrchestrator 包装 QueueService（§9.1，非替换）

读 `review-orchestrator.ts` + `queue.service.ts` diff：

- `ReviewOrchestrator.start(reviewId)`：要求 `review.status === 'running'`，构建 state，调用 `graph.nodes['running']` → `nodeRunning` → `this.queue.enqueue('review.start', {reviewId, sessionId})`（**复用既有 QueueService 派发路径**），随后 checkpoint + persist。✓
- `nodeRunning`：硬闸 `state.round > gates.maxRounds` 检查存在（单轮 round=1 不触顶）→ 派发 round-1 并行 turns。✓
- `handleTurnsComplete`：全部 turn 终态后由 `QueueService.completionHook` 触发 → 跑 `MockModerator.decide` → `summarized` checkpoint/persist → `converge` → `completed` checkpoint/persist（或 `force_stop` → `aborted`）。✓
- `onModuleInit` 把 `queue.completionHook` 接到 `handleTurnsComplete`；未接线时 `queue` 走 legacy 终态判定（不破旧路径）。✓
- turn 执行仍走既有 `executeAgentTurn`（DB 语义元组幂等 + `shouldDispatchTurn` 每评审员硬闸 + `validateOpinion`）。既有路径不破。✓
- **包装非替换成立。**

---

## 5. mock Moderator + 硬闸 + 审计（§5）

读 `moderator.ts` + `hard-gates.ts`：

- `MockModerator.decide`：round-1 summarized 后只做 `converge` → `completed`，**无 `continue_debate`、无 round-2**（见 §3/§7 越界扫描）。✓
- 硬闸 `DEFAULT_HARD_GATES`：`maxRounds=3` / `maxTurnsPerReviewer=3`（泛化 `MODEL_PILOT_MAX_ROLES`）/ `minRounds=1` / `maxTokensPerReview=200000`（仅计数）/ `maxCostPerReview=0`（禁用）。`resolveHardGates()` 从 `MODEL_PILOT_MAX_ROLES` 解析 `maxTurnsPerReviewer`。✓
- 审计落库：`prisma.moderatorDecision.create({reviewId, round, decisionType, reasoning, ruleCheckResult})`，`ruleCheckResult.passed` 随行持久化。✓
- **独立 DB 验证**：见 §8 真实脊柱跑后 `moderator_decisions` 含 `converge` 行且 `ruleCheckResult.passed=true`。

> 注：`minRounds` 在 `HardGates` 中定义，但 `decide()` 未对其做强制校验（仅 `maxRoundsOk` 等被检查）。9.4 单轮 round=1=minRounds 无影响；9.5 round-2 须补 `minRounds` 校验（见 P2-2）。

---

## 6. opinion 校验（§4）

读 `opinion.ts`：`validateOpinion(o)` 校验 `schemaVersion` 正则 `^\d+\.\d+$`、`dimension`/`issue`/`recommendation` 非空、`riskLevel` ∈ {high,medium,low,info}、`confidenceScore` 整数 [0,100]、`citations` 为 `string[]`、`modelOutputRef` 可 JSON.parse 且含 `providerSource`。

- `queue.service.ts` `executeAgentTurn` 在写 opinion 前调用 `validateOpinion`；失败 → turn `failed` + 写 `reviewOpinion` 存根（`issue='opinion validation failed'`）+ `throw new Error('NO_RETRY:…')` 阻断重试，但**不阻断同 review 其他 turn**。✓ 与 §4.2 一致。
- 代码审阅正确，且 Route A/B 实跑均产出有效 opinion（review 终态 completed）。

---

## 7. checkpoint / resume（§6）

读 `postgres-checkpointer.ts`：`save(reviewId, nodeId, state)` 取 `aggregate _max.sequence + 1` 写 `ReviewCheckpoint`；`load(reviewId)` `orderBy sequence desc` 取最新。✓

- **独立验证**：`verify-9.4-spine.js`
  - `(c)` 写 running/summarized 两 checkpoint，`load` 返回最新 `summarized`（resume 锚点正确）PASS
  - `(e.2)` 全链路脊柱写 `running→summarized→completed` 三段 checkpoint PASS
  - `(f)` 预置 `summarized` checkpoint 后 `orchestrator.resume` → 从 `summarized` 恢复 → `handleTurnsComplete` → `completed` PASS

---

## 8. 验证证据（独立重跑，open 项 ⑤）

全部重跑（沙箱可跑，均绿）：

| # | 验证 | 命令 | 结果 |
|---|---|---|---|
| 1 | 后端类型 | `cd apps/api && npx tsc --noEmit --incremental false` | **0 errors** |
| 2 | 前端类型 | `cd apps/web && npx tsc --noEmit` | **0 errors** |
| 3 | 迁移状态 | `cd apps/api && npx prisma migrate status` | 3 migrations / **up to date** |
| 4 | 脊柱验证 | `node apps/api/scripts/verify-9.4-spine.js` | **12/12 PASS**（exit 0） |
| 5 | 运行时冒烟 | `node scripts/smoke-runtime.js` | **31/31 PASS** |
| 6 | 端到端 A | `node scripts/setup-demo-review.js`（HTTP，mock_fallback） | review `f508a2a5…` → **completed**，3 turns |
| 7 | 端到端 B | `node scripts/setup-demo-review.js --with-runner`（db_opinions） | review `335c3c47…` → **completed**，3 turns |

**真实脊柱端到端（open 项 ⑤）独立 DB 取证**（Postgres，Prisma 客户端直查）：

- Route A review `f508a2a5-ffe1-4221-94af-5ad501184db1`（经 HTTP API → orchestrator 脊柱）：
  - `status = completed`，`currentNodeId = completed`，`currentRound = 1`
  - `review_turns` count = 3（CTO/CFO/PMO）
  - `review_checkpoints` = `seq1:running, seq2:summarized, seq3:completed`（**per-node checkpoint 写入**）
  - `moderator_decisions` = `converge(passed=true)`（**审计落库**）
- Route B review `335c3c47-3364-4da8-bd6a-8d5f1f680d3b`（standalone runner，`run-agent-turns-for-review.js`）：`status = completed`，3 turns，**但无 checkpoint / 无 moderator 决策**。

> 说明：standalone runner (`scripts/run-agent-turns-for-review.js`) 经 grep 确认**不引用** `orchestrator`/`completionHook`/`meeting.complete`/`converge`/`moderator`，故走自身 legacy 终态路径完成——与 9.3 行为一致。这符合 open 项 ④「既有 `executeAgentTurn` 路径不破（setup-demo-review B 仍能跑）」：B 仍完成（不破），但 B 不经 orchestrator 脊柱、故不产生 checkpoint/审计属**预期**。真实脊柱端到端由 Route A（HTTP）+ verify (e)/(f) 决定性证明。详见 P2-5。

---

## 9. verify 脚本提交决策（open 项 ⑥）

- `apps/api/scripts/verify-9.4-spine.js` 当前 **未被 .gitignore 忽略**（`git check-ignore` 返回未忽略 → 若 Codex 提交改动将被纳入跟踪）。
- 参照脚本 `fix_uuid.js` / `fix_uuid2.js` / `setup-test-review.js` 在 `.gitignore` L62-65 显式忽略（注释「Local one-off dev/debug scripts (not part of MVP source)」）。
- **不一致**：同属验证/一次性脚本性质，`setup-test-review.js` 被忽略，而 `verify-9.4-spine.js` 未被忽略。

**建议（P1）**：二选一，由 Codex 裁决——
- (A) **gitignore 一致性**：将 `verify-9.4-spine.js` 加入 `.gitignore`（L62 区块），与现有「一次性脚本不进源码」约定对齐；或
- (B) **正式化回归测试**：把它从 `scripts/` 迁到 `tests/`（或 `apps/api/test/`）并作为提交回归测试保留，命名反映其回归属性（如 `verify-spine.e2e.js`）。

两种都不影响 9.4 功能正确性；本 reviewer 倾向 (A) 以保持仓库约定一致，除非团队决定把它作为常驻回归测试。脚本本身正确（12/12），无论哪种决策均**不阻塞 Go**。

---

## 10. 红线 + 密钥

- 默认 mock：`.env` `MODEL_PROVIDER="mock"`、`ALLOW_EXTERNAL_MODEL_CALLS=false`；`MockModerator` 不调真实 LLM。✓
- 密钥扫描：`git grep -nE 'sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]{20,}' -- apps/api/src apps/api/scripts` → **exit=1，零真实命中**（历史 docs 脱敏占位符不计）。✓
- 未 `git commit` / 未 `git push` / 未 `--force`（本复审亦不提交）。✓
- 落点正确：仅 7 代码改 + 2 文档在 working tree。

---

## 11. 6 个 open 项独立结论

| # | open 项 | 独立结论 |
|---|---|---|
| ① | graph runtime 忠实 Contract §2 | **通过**。所有 §2 类型落地；`ReviewStatus`=7 值规范集与任务书一致。`edges` 为声明式、执行为命令式（P2-3）。 |
| ② | 幂等 3/4 段键 | **通过（CRITICAL 满足）**。`findExistingTerminalTurn` 按语义元组查询，verify (a.1/a.2/a.3) + 真实 DB 均证明覆盖 3 段与 4 段键。latent：`round` 未在派发 payload 贯通（P2-1）。 |
| ③ | 无 9.5 越界 | **通过**。扫描 `advance_round`/`continue_debate`/`terminate_proposal` 仅出现在类型定义；无 `currentRound++`/round 循环；MockModerator 只 `converge`/`force_stop`。 |
| ④ | 包装非替换 QueueService | **通过**。`ReviewOrchestrator` 复用 `queue.enqueue('review.start')` → `executeAgentTurn`；`completionHook` 委派；Route B legacy 路径仍完成（不破）。 |
| ⑤ | 真实脊柱端到端 | **通过**。Route A 真实 review → completed + per-node checkpoint(running/summarized/completed) + converge(passed=true)；verify (e)/(f) 同证；Route B 经 legacy 完成（预期，P2-5）。 |
| ⑥ | verify 脚本提交决策 | **P1（决策，非阻塞）**。脚本未被 gitignore，与同类一次性脚本约定不一致；建议 gitignore 或迁 `tests/` 正式化。 |

---

## 12. P0 / P1 / P2 清单

### P0（必阻塞 No-Go）：0 条
- schema 未动 ✓ ｜ 前端未动 ✓ ｜ 无 9.5 越界 ✓ ｜ 幂等覆盖 4 段键 ✓ ｜ QueueService 路径不破 ✓ ｜ tsc(api+web)=0 ✓ ｜ 无真实密钥 ✓ ｜ 三连查完成 ✓

### P1（可登记，Gate 裁决）：1 条
- **P1-1**：`verify-9.4-spine.js` 未被 `.gitignore` 忽略，与 `fix_uuid*`/`setup-test-review.js` 的「一次性脚本忽略」约定不一致。建议 gitignore 或迁 `tests/` 正式化（见 §9/⑥）。**非阻塞**。

### P2（留档不阻塞）：5 条
- **P2-1**：派发 payload 未携带 `round`，`executeAgentTurn` 读 `payload.round ?? 1`，`reviewTurn.create` 写死 `round:1`。9.4 单轮正确，但 `round` 未贯通；9.5 round-2 须补 `round` 传递（否则幂等/语义元组在 round-2 仍恒按 round=1）。
- **P2-2**：`HardGates.minRounds` 已定义但 `MockModerator.decide()` 未强制校验。9.4 无影响（round=1=min），9.5 round-2 须补 `minRounds` 校验（低于下限即使想停也必须继续）。
- **P2-3**：`Graph.edges` 为声明式，实际流程由 `handleTurnsComplete` 命令式驱动，无运行时图遍历引擎；`summarized` 的 conditional edge `route: s => s.status==='aborted' ? 'aborted':'completed'` 在 status 已是 `summarized` 时恒返回 `completed`，与命令式 `force_stop→aborted` 分支重复/死代码。9.4 单轮可接受，建议在 9.5 将图结构真正接入运行时或删除声明式死边。
- **P2-4**：`ReviewStatus` 类型仅 7 值，缺 9.3 枚举的 `interrupted`/`archived`；`isTerminalStatus` 相应只含 completed/failed/aborted。single-round 脊柱不驱动这两态，但 9.5 引入中断/HITL/resume 路径时需补。
- **P2-5**：Route B（standalone runner）完成 review 后 `currentNodeId` 残留 `running`（终态 `status=completed` 权威，无功能影响），且不经 orchestrator 故无 checkpoint/审计。属 runner 自身 legacy 路径范围，非 9.4 要求；记录以备 9.5 若要让 runner 也走脊柱时统一接线。

---

## 13. 结论与 Codex 回报建议

### 结论：**Go**

P0 = 0 ｜ P1 = 1 ｜ P2 = 5。

所有必查项独立取证通过：变更范围与加性边界成立（schema/web 未动、零迁移、无 9.5 越界）；graph runtime 忠实 Contract §2；**幂等 CRITICAL 项（3/4 段键覆盖）通过**；ReviewOrchestrator 包装非替换 QueueService；mock Moderator + 硬闸 + 审计落库；opinion 校验；checkpoint/resume；验证链全绿（tsc api+web=0 / migrate up to date / verify 12/12 / smoke 31/31 / Route A 真实脊柱 completed + per-node checkpoint + converge 审计 / Route B 仍完成）；密钥扫描干净；未提交。

### 给 Codex 的回报
- **Go / No-Go**：Go
- **P0/P1/P2**：P0=0，P1=1（verify 脚本 gitignore 一致性），P2=5
- **6 open 项**：① 忠实 ✓ ② 幂等 3/4 段 ✓（CRITICAL 满足）③ 无 9.5 越界 ✓ ④ 包装非替换 ✓ ⑤ 真实脊柱端到端 ✓ ⑥ verify 脚本提交决策 = P1（建议 gitignore 或迁 tests/）
- **是否建议提交入库**：✅ 建议。提交 7 代码改 + `ACTIVE_SPRINT.md` + `Sprint_9.4_Orchestrator_Spine_Backend.md`；并就 P1-1 一并处理 `verify-9.4-spine.js` 的 gitignore/迁移决策。
- **是否建议进入 9.5**（round-2 + 多轮 + max_rounds 兜底，标准 Gate）：✅ 建议。9.4 已把 P1 编排地基（graph runtime + ReviewOrchestrator + mock Moderator + checkpoint + 语义元组幂等 + opinion 校验）真正驱动起评审流程；进入 9.5 前请知悉并修复 P2-1（round 贯通）、P2-2（minRounds 校验）、P2-3（图声明式 vs 命令式）、P2-4（interrupted/archived 补入 ReviewStatus），这些是当前单轮实现下被掩盖、9.5 多轮会被触发的缺口。

### 复审副作用说明（供 Codex/用户知悉）
- 本复审为独立重跑验证，启动了 API server（`node dist/main.js`，后台，占用 :4000）以跑 smoke 与 Route A/B；进程未停，不影响交付，可酌情由 Codex/用户清理。
- `apps/api/dist` 经 `nest build` 刷新（仅本地构建产物，已在 .gitignore L7，不入库）。
- 临时查询脚本 `/tmp/query_9_4.js` 为本地 scratch，不在仓库内。
