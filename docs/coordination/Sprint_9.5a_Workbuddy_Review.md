# Sprint 9.5a — P1 多轮地基（修 9.4 review P2-1~P2-4）· Workbuddy 独立复审

- **模式**：标准 Gate（行为变更：round 贯通 / minRounds 强制 / 条件边真路由 / Status 补值）
- **复审对象**：Sprint 9.5a — P1 Multi-Round Foundation
- **基线**：9.4 Go / `7a8b4e6`（9.4 已 commit）
- **main HEAD**：`7a8b4e6`
- **复审日期**：2026-07-14
- **复审 agent**：workbuddy-review（独立 Gate 审查，与 workbuddy-coder 不同上下文；未采信 coder 证据文档 / Codex 协调核验；结论全部自查磁盘/git/代码/DB，可重跑项独立重跑）
- **原则**：只审查不改代码、不改文档；不 `git commit`/`push`。

---

## 0. 三连查（强制 P0，已执行）

| 步骤 | 命令 | 观测 |
|---|---|---|
| toplevel | `git rev-parse --show-toplevel` | `D:/workspace/PrismReview` ✓ |
| remote | `git remote -v` | `origin = https://github.com/feather100/PrismReview.git` ✓ |
| status | `git status --short` | 7 条目（4 源码 + .gitignore + ACTIVE_SPRINT + 9.5a 文档），无越界 ✓ |
| pull | `git pull --ff-only origin main` | `Already up to date`（基线 `7a8b4e6`）✓ |

> 注：本环境 `grep` 为 shell function 会报 "conflicting matchers"，全过程扫描一律用 `git grep` / `command grep`。

---

## 1. 变更范围 + 边界（必查项 1）

**独立取证**：`git status --short` 恰好：
```
 M .gitignore
 M apps/api/src/modules/reviews/orchestrator/graph-runtime.ts
 M apps/api/src/modules/reviews/orchestrator/moderator.ts
 M apps/api/src/modules/reviews/orchestrator/review-orchestrator.ts
 M apps/api/src/modules/reviews/queue/queue.service.ts
 M docs/coordination/ACTIVE_SPRINT.md
?? docs/coordination/Sprint_9.5a_MultiRound_Foundation_Backend.md
```
- 无 `.env` / `node_modules` / `data` / `.reasonix` / `.workbuddy` / 日志。
- **`schema.prisma` 未动**：`git diff --name-only apps/api/prisma/schema.prisma` → 空输出 ✓（P0 红线通过）。
- **`apps/web` 未动**：`git diff --name-only apps/web` → 空输出 ✓（P0 红线通过）。
- verify 脚本 `apps/api/scripts/verify-9.5a-multiround-foundation.js` 被 `.gitignore` 通配符 `verify-*.js` 忽略，`git status` 不显示 → 符合一次性脚本约定 ✓。
- **无 9.5b 越界**：`command grep -rnE "currentRound\s*\+\+|round\+\+|\.round\+\+|continue_debate"` 仅命中 `graph-runtime.ts:52`（`continue_debate` 类型定义行）；`advance_round` / `continue_debate` 仅作为 `routeAfterSummarized` 的 `case` 分支值存在，**无** round-2 debate 派发、**无** `continue_debate` 冲突检测实现、**无**多轮 `[running→summarized]*` 循环。 ✓

**判定**：范围合规，无 P0 越界。

---

## 2. P2-1 round 贯通（CRITICAL，必查项 2）

**代码取证**（`queue.service.ts` diff）：
- `executeReviewStart`（`:129`）：`const round = payload.round ?? (review as any).currentRound ?? 1;` 派发链下传 round（orchestrator 显式传 `state.round`，故 `payload.round` 必为语义正确值）。
- `agent.turn.execute` payload（`:186`）：新增 `round` 字段贯通到 turn 执行。
- `executeAgentTurn`（`:231` 起）：**严格校验** `payload.round`（缺失/非整数/<1 → `throw new Error('NO_RETRY: ...')`），**不再静默 `?? 1`**。
- `reviewTurn.create`（`:259`）：`round` 与 `idempotencyKey = \`${reviewId}::${roleVersionId}::${round}\`` 均取派发值。
- `opinionCandidate.round`（`:352`）：取派发链下传 `round`。
- `review-orchestrator.ts`（`:153-158`）：`enqueue('review.start', { ..., round: state.round })`，`state.round` 初始化自 `review.currentRound ?? 1`（`graph-runtime` ReviewState + `:284`）。

**9.5b 越界复核**：无 round-2 派发；`advance_round` 仅作 Moderator 决策值 + 条件路由分支，9.5a 不触达 round-2（保持 `summarized`，分支留空）。

**独立重跑验证**：
- `verify-9.5a` (P2-1a.1)：round=2 正确写入 `reviewTurn.round=2` + key `…::2` → PASS
- (P2-1a.2)：round=1 vs round=2 幂等键互异（无 9.5 冲突）→ PASS
- (P2-1a.3)：语义元组幂等按接收 round（r2 命中 / r1 未命中）→ PASS
- (P2-1b)：缺 round → `NO_RETRY` 拒绝，0 turn 创建 → PASS
- **真实 DB 实证**（Route A `d45731c0`）：sampleTurn `round=1, key=…::1` ✓（单轮下 round 正确贯通）

**判定**：P2-1 真实生效，CRITICAL 项通过。

---

## 3. P2-2 minRounds 强制（必查项 3）

**代码取证**（`moderator.ts` diff，`decide()`）：
- 新增分支：`else if (round < gates.minRounds) { decisionType = 'advance_round'; ... }` 在 convergence 满足但仍未达下限时禁 converge。
- 硬闸 `force_stop` 分支维持优先（收敛未达 → force_stop），`advance_round` 不覆盖硬闸。

**独立重跑验证**（verify-9.5a）：
- (P2-2.1)：`minRounds=2, round=1` → `advance_round` → PASS
- (P2-2.2)：`minRounds=1, round=1 ≥ 1` → `converge`（9.4 行为不变）→ PASS
- (P2-2.3)：`minRounds=3, round=2` → `advance_round` → PASS

**判定**：P2-2 真实生效，9.4 单轮回归保持。

---

## 4. P2-3 条件边真路由（必查项 4）

**代码取证**（`review-orchestrator.ts` diff）：
- 新增纯函数 `routeAfterSummarized(type)`：`converge`/`terminate_proposal`→`completed`、`force_stop`→`aborted`、`advance_round`/`continue_debate`→`summarized`，`default`→`summarized`。
- `buildGraph`：移除硬编码 `{ kind:'static', from:'summarized', to:'completed' }`，`summarized` 条件边改为 `route: (s) => routeAfterSummarized(s.lastDecisionType ?? 'converge')`。
- `handleTurnsComplete`：`const next = routeAfterSummarized(decision.decisionType);` 按结果分支（`aborted`/`summarized`/`completed`），并写入 `lastDecisionType` 到 `summarizedState`（供边读取）。
- **非死代码**：条件边 `route` 被真实调用（P2-3.1 直接断言边函数；P2-3.2/3.3 经 `handleTurnsComplete` 全链路验证），不再恒返回 `completed`。

**独立重跑验证**（verify-9.5a）：
- (P2-3.1)：`converge→completed, force_stop→aborted, advance_round→summarized, continue_debate→summarized` → PASS
- (P2-3.2)：`advance_round` 决策 → review 保持 `summarized`（不进 completed）→ PASS
- (P2-3.3)：`converge` 决策 → review 达 `completed`（9.4 行为回归）→ PASS

**判定**：P2-3 真实生效，条件边真路由、非死代码。

---

## 5. P2-4 ReviewStatus 补值（必查项 5）

**代码取证**（`graph-runtime.ts` diff）：
- `ReviewStatus` 联合加 `interrupted | archived`（注释说明：`interrupted`=HITL 暂停非终态，`archived`=9.3 物理枚举归档终态）。
- `ReviewState` 加 `lastDecisionType?: ModeratorDecisionType`（供 summarized 条件边读取，P2-3 用）。
- `TERMINAL_STATUSES`：`archived` 在终态集合内；`interrupted` **刻意不在**（可恢复 → running）。

**独立重跑验证**（verify-9.5a）：
- (P2-4.1)：`archived` 是终态（`isTerminalStatus('archived')=true` 且集合含）→ PASS
- (P2-4.2)：`interrupted` 非终态（`isTerminalStatus('interrupted')=false` 且集合不含）→ PASS

**判定**：P2-4 真实生效。

---

## 6. 验证证据（独立重跑，必查项 6）

| 验证项 | 命令 / 来源 | 结果 |
|---|---|---|
| tsc api | `cd apps/api && npx tsc --noEmit --incremental false` | **0 errors** |
| tsc web | `cd apps/web && npx tsc --noEmit` | **0 errors** |
| migrate | `npx prisma migrate status` | 3 migrations / **schema up to date**（9.5a 零迁移 → schema 未动实证）|
| verify-9.5a | `node apps/api/scripts/verify-9.5a-multiround-foundation.js` | **15/15 PASS**（P2-1a×3 / P2-1b / P2-2×3 / P2-3×3 / P2-4×2 / REG×3）|
| smoke | `node scripts/smoke-runtime.js` | **31/31 PASS** |
| Route A | `node scripts/setup-demo-review.js` | review `d45731c0…` → 经 HTTP 由 orchestrator 驱动 |
| Route B | `node scripts/setup-demo-review.js --with-runner` | review `bd897d9d…` → `completed`（exit 0）|
| 真实脊柱回归 | `psql`-等价 Prisma 查询（Route A `d45731c0`） | `status=completed`, checkpoints `[running,summarized,completed]`, `converge(passed=true)`, turn `round=1`+key `…::1` |
| 密钥 | `git grep -nE 'sk-…|Bearer …' -- apps/api/src apps/api/scripts` | exit=1（零真实命中）|

> 沙箱 Postgres 容器隔夜停止，复审时启动 Docker Desktop + `docker compose up -d` 恢复；API server 经 `node dist/main.js`（后台，:4000）恢复以跑 smoke / Route A / Route B。dist 经 `npx nest build` 刷新（已 gitignore，不入库）。属只读验证副作用。

---

## 7. .gitignore + 红线 + 密钥（必查项 7）

- **.gitignore**：由 `apps/api/scripts/verify-9.4-spine.js` 单行改为通配符 `apps/api/scripts/verify-*.js`（9.4+9.5a 一致忽略）。`git check-ignore` 确认 `verify-9.4-spine.js` 与 `verify-9.5a-multiround-foundation.js` **均 ignored** → 顺带闭合 9.4 P1-1（验证脚本提交一致性）。
- **默认 mock**：`.env` `MODEL_PROVIDER="mock"`、`ALLOW_EXTERNAL_MODEL_CALLS=false`；Moderator 为 mock；无真实 LLM 调用。
- **密钥**：`git grep` 零真实命中（仅历史 docs 脱敏占位符，不计）。
- **未提交**：未 `git commit`/`push`/`--force`；落点正确。

---

## 8. 结论

### **Go** — P0 = 0 / P1 = 0 / P2 = 0

**P0 清单（必阻塞，全部未触发）**：
| # | 检查 | 证据 | 结果 |
|---|---|---|---|
| P0-1 | 改 schema | `git diff schema.prisma` 空 | 通过 |
| P0-2 | 改前端 | `git diff apps/web` 空 | 通过 |
| P0-3 | 越界 9.5b（round-2 派发/循环） | over-reach 扫描仅类型定义 | 通过 |
| P0-4 | P2-1 严格校验破坏 Route B | Route B 经 legacy runner（直写 Prisma，不经 `executeAgentTurn`），真实 DB 确认 `completed` | 通过 |
| P0-5 | min_rounds=1 回归破 | verify REG.1/2/3 + Route A 真实 `completed`+checkpoints+converge | 通过 |
| P0-6 | 条件边仍死代码 | P2-3.1/2/3 真路由非恒 completed | 通过 |
| P0-7 | tsc 非 0 | api+web 双 0 | 通过 |
| P0-8 | 真实密钥 | `git grep` exit=1 | 通过 |
| P0-9 | 未三连查 | 三连查全过 | 通过 |

**P1 清单（可登记，Gate 裁决）**：无。9.4 P1-1（verify 脚本 gitignore 不一致）已在 9.5a 以 `verify-*.js` 通配符闭合。

**P2 清单（留档不阻塞）**：无代码级 P2 缺陷。以下为 **9.5b 须知悉项（非 9.5a 缺陷，不计入判定）**：
- `continue_debate → running(r2)` 分支在 `routeAfterSummarized` 中显式留空（返回 `summarized`），9.5b 须实现 round-2 派发并改此分支为 `running`。
- 多轮 `max_rounds` 硬闸当前仅在 `startReview`（`:145` `state.round > gates.maxRounds`）校验单轮起点；9.5b 每轮派发前须重新校验（Contract §5.3 要求"每转移前校验"）。
- `advance_round` 在 9.5a 下使 review 永久停留 `summarized`（无 round-2 派发方）；9.5b 须补 `handleTurnsComplete` 中 `next==='summarized'` 的 round-2 派发逻辑（当前仅 log 后 return）。

---

## 9. 6 个 open 项独立结论

| # | open 项 | 独立结论 |
|---|---|---|
| ① | 4 条 P2 修正是否真实生效 | **全生效**。P2-1（verify P2-1a×3/P2-1b + 真实 DB turn.round/idempotencyKey）+ P2-2（P2-2.1/2/3）+ P2-3（P2-3.1/2/3，含非死代码）+ P2-4（P2-4.1/2）。 |
| ② | min_rounds=1 单轮回归不破 | **不破**。verify REG.1/2/3（completed + per-node checkpoint + converge 审计 passed）+ 真实 Route A（`d45731c0`）：`status=completed`, checkpoints `[running,summarized,completed]`, `converge=true`。9.4 行为完全保持。 |
| ③ | 无 9.5b 越界 | **确认无越界**。over-reach 扫描空（仅 `continue_debate` 类型定义）；`advance_round`/`continue_debate` 仅作条件路由分支值，无 round-2 派发/多轮循环/冲突检测实现。 |
| ④ | executeAgentTurn 严格校验是否破坏 Route B | **不破**。Route B 走 `run-agent-turns-for-review.js`，直写 `reviewTurn`（含 `round:1`）经 Prisma，**从不调用 `executeAgentTurn`**；真实 DB 确认 `bd897d9d` `completed`。严格 `NO_RETRY` 仅作用于 orchestrator 驱动的 HTTP 脊柱（Route A），其 round 贯通正确。 |
| ⑤ | 真实脊柱端到端（min_rounds=1） | **通过**。Route A 经 HTTP 真实跑通 `created→diagnosed→running→summarized→completed` + per-node checkpoint + converge 审计；verify REG 同证。 |
| ⑥ | verify 脚本提交决策 | **已决策并落地**（非 P1）：`.gitignore` 改 `verify-*.js` 通配符，9.4+9.5a 两脚本一致忽略，符合 `fix_uuid*`/`setup-test-review` 一次性脚本约定；未进跟踪，无需提交。 |

---

## 10. 给 Codex 的回报摘要

- **结论**：**Go**（P0=0 / P1=0 / P2=0）。
- **强制验收**：4 条 P2 修正（round 贯通 / minRounds 强制 / 条件边真路由 / Status 补值）均经代码取证 + 独立重跑（verify 15/15）+ 真实 DB 实证确认生效；9.4 单轮行为（min_rounds=1 回归）完整保持。
- **越界**：无 9.5b 越界；`continue_debate→running(r2)` 空分支为有意留待 9.5b。
- **建议提交入库**：✅ 建议 —— 4 源码 + `.gitignore` + `ACTIVE_SPRINT.md` + `Sprint_9.5a_MultiRound_Foundation_Backend.md`；verify 脚本已被 gitignore，不入库。
- **建议进入 9.5b**（round-2 + 多轮 + max_rounds 兜底，标准 Gate）：✅ 建议 —— 9.5a 已把 9.4 单轮脊柱在多轮语义下地基打牢；进入前请就 §8 「9.5b 须知悉项」补：`continue_debate→running(r2)` 分支实现、每轮 `max_rounds` 重校验、`next==='summarized'` 的 round-2 派发逻辑。

> 复审副作用（仅供参考，不影响交付）：为跑 smoke/Route A/B 启动 Docker Desktop + `docker compose up -d` + API server（`node dist/main.js` 后台 :4000）；`nest build` 刷新 dist（gitignore）。如需释放资源可由 Codex/你侧停相关进程。
