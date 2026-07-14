# Sprint 9.5b — P1 收官（round-2 + 多轮 + max_rounds 兜底）· Workbuddy 实现记录

- **模式**：标准 Gate（行为变更：round-2 mock debater 派发 / `continue_debate` 冲突检测 / 多轮 `[running→summarized]*` 循环 / `max_rounds` 每轮兜底）
- **实现对象**：Sprint 9.5b — P1 Multi-Round Debate Backend（P1 最后一仗）
- **基线**：9.5a Go（本环境未提交，工作树 `12a6d3a` 基线之上 3 文件改动）／ `7a8b4e6` 为 9.4 已 commit HEAD
- **main HEAD（起点）**：`12a6d3a`
- **实现日期**：2026-07-14
- **实现 agent**：workbuddy-coder
- **原则**：标准 Gate 范围、默认 mock、不写密钥、不改 schema、不改前端、不 `git commit`/`push`。

---

## 0. 三连查（强制 P0，已执行）

| 步骤 | 命令 | 观测 |
|---|---|---|
| toplevel | `git rev-parse --show-toplevel` | `D:/workspace/PrismReview` ✓ |
| remote | `git remote -v` | `origin = https://github.com/feather100/PrismReview.git` ✓ |
| status | `git status --short` | 恰好 3 源码条目（见 §1），无越界 ✓ |
| pull | `git pull --ff-only origin main` | `Already up to date`（基线 `12a6d3a`）✓ |

> 注：本环境 `grep` 为 shell function 会报 "conflicting matchers"，全过程扫描一律用 `git grep` / `command grep`。

---

## 1. 变更范围 + 边界（必查项 1）

**独立取证**：`git status --short` 恰好：
```
 M apps/api/src/modules/reviews/orchestrator/moderator.ts
 M apps/api/src/modules/reviews/orchestrator/review-orchestrator.ts
 M apps/api/src/modules/reviews/queue/queue.service.ts
```
- 无 `.env` / `node_modules` / `data` / `.reasonix` / `.workbuddy` / 日志。
- **`schema.prisma` 未动**：`git diff --name-only apps/api/prisma/schema.prisma` → 空输出 ✓（P0 红线通过，沿用 9.2 schema）。
- **`apps/web` 未动**：`git diff --name-only apps/web` → 空输出 ✓（P0 红线通过，API 契约保留）。
- verify 脚本 `apps/api/scripts/verify-9.5b-multiround.js` 被 `.gitignore` 通配符 `verify-*.js` 忽略，`git status` 不显示 → 符合一次性脚本约定 ✓。
- **前端零改动**：9.5b 全部逻辑在 `orchestrator/` 与 `queue.service.ts` 应用层，API 契约未改。

**判定**：范围合规，无 P0 越界。

---

## 2. 三条须知悉项落地（9.5a review §8 遗留，本次全部闭合）

9.5a 复审遗留 3 条 9.5b 须知悉项（原 9.5a 文档 §8 第 164-167 行），本次全部实现并实测：

| # | 须知悉项（9.5a 原文） | 9.5b 落地 | 实测 |
|---|---|---|---|
| ① | `continue_debate → running(r2)` 分支在 `routeAfterSummarized` 显式留空（返 `summarized`），9.5b 须实现 round-2 派发并改此分支为 `running` | `routeAfterSummarized` 的 `advance_round`/`continue_debate` 现均返回 `'running'`（`review-orchestrator.ts:50,52`）；`handleTurnsComplete` 新增 `next==='running'` 分支派发 round-N | verify S2.1（continue_debate→running(r2) 派发）、S3.1（advance_round 也派发 round-2）PASS |
| ② | 多轮 `max_rounds` 硬闸仅 `startReview` 校验单轮起点；9.5b 每轮派发前须重校验（Contract §5.3"每转移前校验"） | `handleTurnsComplete` `next==='running'` 分支防御性双闸：`if (nextRound > gates.maxRounds) → force_stop→aborted`（`review-orchestrator.ts:220-234`）；`Moderator.decide()` 在 `round >= maxRounds` 返 `force_stop`（`moderator.ts:99-102`） | verify S1.6（第 4 轮不派发）、S1.3（决策序列含 force_stop）PASS |
| ③ | `advance_round` 在 9.5a 下使 review 永久停留 `summarized`（无 round-2 派发方）；9.5b 须补 `handleTurnsComplete` 中 `next==='summarized'` 的 round-2 派发逻辑 | 统一为 `running` 节点：`advance_round` 与 `continue_debate` 路由到同一 `next==='running'` 分支 → `currentRound++` + 派发 round-N（`review-orchestrator.ts:215-247`） | verify S3.1（minRounds 未达标 advance_round 仍派发 round-2）PASS |

---

## 3. round-2 mock debater 实现（Conflict-Aware Heuristic）

**代码取证**（`moderator.ts` diff）：

- 新增冲突检测启发式（Contract §10 round-2 mock debater：确定性、phase='debate'、不依赖真实模型）：
  ```ts
  // moderator.ts:75-76
  const conflictCount = await this.detectConflict(state.reviewId, round);
  const conflict = conflictCount >= 2;   // 本轮 ≥2 条 high-risk opinion → 冲突
  ```
- 新增私有方法 `detectConflict(reviewId, round)`（`:149` 起）：读 `reviewTurn.findMany({where:{reviewId,round}})` 取 turnIds → `reviewOpinion.findMany({where:{turnId:{in:turnIds}}})` 统计 `riskLevel.toLowerCase()==='high'` 数量；<2 turns 返回 0。
- 决策分支顺序（`:85-106`）：硬闸 `force_stop` → `max_turns` → convergence → `round < minRounds`→`advance_round` → **`round >= maxRounds`→`force_stop`（9.5b 兜底）** → **`conflict`→`continue_debate`（9.5b round-2 mock debater）** → 默认 `converge`。

**queue.service.ts 派发语义取证**（`queue.service.ts` diff）：

- `executeReviewStart` 派发 `agent.turn.execute` 的 jobId 改 `agent.turn.execute.${reviewId}.r${round}.${turnIndex}`（`:181`，带 round，避免 round-1 `processedIds` 命中阻止 round-2）；payload 新增 `phase: round >= 2 ? 'debate' : 'round_robin'`。
- `executeAgentTurn` 创建 ReviewTurn 时 `const turnPhase = payload.phase === 'debate' ? 'debate' : 'round_robin';`（`:258`，替换写死 `'round_robin'`）。

**独立重跑验证**（verify-9.5b S1.4/S1.5）：
- (round-2 派发) round≥2 turns `phase==='debate'` → PASS（debateTurns=4）
- (conflict 启发式) CTO+Compliance 双 high → round-1/2 决策 `continue_debate` → PASS

**判定**：round-2 mock debater 真实生效，确定性、不依赖真实模型、不调外部 LLM。

---

## 4. 多轮循环实现（running(r2) ↔ summarized 交替）

**代码取证**（`review-orchestrator.ts` diff）：

- `routeAfterSummarized(type)`（`:41-53`）：`converge`/`terminate_proposal`→`completed`、`force_stop`→`aborted`、`advance_round`/`continue_debate`→**`running`**，`default`→`running`。`NextNode` 类型由 `'completed'|'aborted'|'summarized'` 改为 `'completed'|'aborted'|'running'`（9.5a 返 `summarized` 的空分支已闭合）。
- `handleTurnsComplete`（`:199-247`）：`const next = routeAfterSummarized(decision.decisionType);` 新增 `next==='running'` 分支：
  ```ts
  const nextRound = state.round + 1;
  if (nextRound > gates.maxRounds) { /* → force_stop → aborted（须知悉项 2 防御闸）*/ }
  else {
    const runningState = { ...state, round: nextRound, status: 'running', lastDecisionType: decision.decisionType };
    await this.checkpoint(reviewId, 'running', runningState);
    await this.persistState(reviewId, runningState);   // 写 currentRound=nextRound
    this.queue.enqueue('review.start', { reviewId, sessionId: `session-${id}-r${nextRound}`, round: nextRound });
  }
  ```
- `summarized` 条件边读 `state.lastDecisionType`（`buildGraph` `:110`）驱动下一次路由，形成 `[running→summarized]*→(completed|aborted)` 闭环。

**独立重跑验证**（verify-9.5b S1/S2）：
- S1：CTO+Compliance 双 high → round-1 `continue_debate`→running(r2)→round-2 `continue_debate`→running(r3)→round-3 `force_stop`→aborted；`currentRound=3`；决策序列 `1:continue_debate,2:continue_debate,3:force_stop`；turns `rounds=[1,1,2,2,3,3]`；checkpoints 7 条 `[running,summarized,running,summarized,running,summarized,aborted]`。
- S2：受控 2 轮 → round-1 `continue_debate`→running(r2)→round-2 `converge`→`completed`；`currentRound=2`，决策序列 `1:continue_debate,2:converge`。

**判定**：多轮循环真实生效，`advance_round` 与 `continue_debate` 统一走 `running` 节点推进 `currentRound`。

---

## 5. max_rounds 兜底实现（每轮重校验双闸）

**代码取证**：

- **闸 1（Moderator 决策层）**：`moderator.ts:99-102` `else if (round >= gates.maxRounds) { decisionType='force_stop' }` —— 第 `maxRounds` 轮决策即返回 `force_stop`，不派发第 `maxRounds+1` 轮。
- **闸 2（Orchestrator 派发层，防御性）**：`review-orchestrator.ts:220-234` `if (nextRound > gates.maxRounds) → force_stop → aborted`，即便 Moderator 漏判也由派发层兜底，绝不派发超界轮次。
- 起点闸（9.4/9.5a 既有）：`review-orchestrator.ts:147-149` `if (state.round > gates.maxRounds) → force_stop`。

**独立重跑验证**（verify-9.5b S1.6/S1.3）：
- (max_rounds 兜底) `maxRounds=3`：第 4 轮**不派发**（无 `round>=4` turn）→ PASS；决策序列末位为 `force_stop` → PASS。

**判定**：`max_rounds=3` 硬闸每轮重校验生效，到顶强制 `aborted`，无无限辩论。

---

## 6. round-scoped 幂等（多轮 correctness 关键设计）

**代码取证**（`queue.service.ts` diff，解决 9.5a 单轮下不可见的 round 串扰）：

- `checkMeetingComplete`（`:437-445`）：`currentRound = review.currentRound ?? 1`；`terminalForRound = reviewTurn.count({where:{reviewId, round:currentRound, status:IN[...]}})`（按 round 过滤，否则 round-2 首个 turn 完成时累计 terminal 已≥expectedCount 误触发）；jobId `meeting.complete.${reviewId}.r${currentRound}`（`:444`，带 round，避免 processedIds 命中阻止 round-2）。
- `executeMeetingComplete`（`:452-494`）：payload 带 `round: currentRound`；`currentRound = payloadRound ?? review.currentRound ?? 1`；terminal 判定用 `completedForRound`/`failedForRound`（按 round 过滤）；legacy 兜底分支变量名同步为 `completedForRound`/`failedForRound`（修复 9.5b 初版 `completedCount`/`failedCount` 引用错误）。
- `agent.turn.execute` jobId 带 `r${round}`（`:181`），round-2 turn 不被 round-1 `processedIds` 拦截。

**独立重跑验证**（verify-9.5b S1.9/S1.10/S1.11/S1.12 + S3）：
- (S1.9) 幂等 3 段键 `(reviewId, roleVersionId, round=2)` 命中 → PASS
- (S1.10) 其他 reviewer round=2 不命中 → PASS
- (S1.11) 4 段消歧键 `…::2::2` 语义元组仍命中 → PASS
- (S1.12) `idempotencyKey` 与 `round` 一致（P2-1 回归）→ PASS

**判定**：round-scoped 幂等与派发键真实生效，多轮下 turn 不串扰、不重复派发。

---

## 7. 验证证据（独立重跑，必查项 6）

| 验证项 | 命令 / 来源 | 结果 |
|---|---|---|
| tsc api | `cd apps/api && npx tsc --noEmit --incremental false` | **0 errors** |
| tsc web | `cd apps/web && npx tsc --noEmit` | **0 errors** |
| migrate | `npx prisma migrate status` | 3 migrations / **schema up to date**（9.5b 零迁移 → schema 未动实证）|
| verify-9.5b | `node apps/api/scripts/verify-9.5b-multiround.js` | **22/22 PASS**（S0 回归 4 + S1 三轮回合 12 + S2 2 轮回合 5 + S3 advance_round 派发 1）|
| smoke | `node scripts/smoke-runtime.js --base http://localhost:4000` | **31/31 PASS** |
| 密钥 | `git grep -nE 'sk-…|AKIA…|ghp_…|xox…|eyJ…' -- apps/api/src apps/web/src` | exit=1（零真实命中）|

**verify-9.5b 关键断言明细**：
- S0：CFO/PMO/UserAdvocate 零 high → 单轮 `completed` + per-node checkpoint 回归（4/4）。
- S1：CTO+Compliance 双 high → 3 轮全链路 `aborted` / `currentRound=3` / 决策序列 `continue_debate×2 + force_stop` / `turns.rounds=[1,1,2,2,3,3]` / `debateTurns=4` / 第 4 轮不派发 / 7 条 checkpoint（含 `aborted`）/ 审计 `passed=[true,true,true]` / 幂等 3 段命中 + 其他 reviewer 不命中（12/12）。
- S2：受控 2 轮 → `continue_debate→running(r2)` 派发（须知悉项①）+ round-2 收敛 `completed`（5/5）。
- S3：`advance_round`（minRounds 未达标）→ 仍派发 round-2（须知悉项③）（1/1）。

> 沙箱 Postgres 容器（`prismreview-postgres`，healthy）实时连接；API server 经 `node dist/main.js`（后台 :4000）恢复以跑 smoke；dist 经 `npx nest build` 刷新（gitignore，不入库）。属只读验证副作用。verify 脚本命中真实 Prisma + 真实 QueueService/ReviewOrchestrator/MockModerator 全链路实例。

---

## 8. 未做 P2+ 声明（范围 Out，明确留档）

以下为 9.5b **范围外**，本次**未触碰**，与任务范围 In/Out 一致：

- **真 LLM Moderator（P2）**：沿用 mock Moderator（确定性决策 + 冲突启发式），`max_cost_per_review=0`，不调真实模型。
- **ModelAdapter 泛化（P2）**：未改动 provider 抽象。
- **Memory / Prompt Service（P3）**：未实现跨轮记忆 / 提示服务。
- **Tool / HITL（P4）**：`interrupted` 状态虽 9.5a 已补联合类型，但 HITL 暂停/恢复流程未实现。
- **opinion 校验规则改动**：沿用 9.4/9.5a 既有 schema 运行校验，无改动。
- **schema 变更**：零迁移，沿用 9.2 已加 `ReviewTurn.round/phase/idempotencyKey`、`ReviewCheckpoint`、`ModeratorDecision`。
- **前端改动**：零，API 契约保留。

---

## 9. 红线核对（必查项 7）

- **默认 mock**：`.env` `MODEL_PROVIDER="mock"`、`ALLOW_EXTERNAL_MODEL_CALLS=false`；Moderator 为 mock；无真实 LLM 调用。
- **不写密钥**：`MODEL_API_KEY` 不落库/不提交；仅描述 env 守卫语义。
- **不提交**：未 `git commit`/`push`/`--force`；落点正确（`docs/coordination/`）。
- **密钥扫描净**：`git grep` 零真实命中（仅历史 docs 脱敏占位符 `sk-xxxxxxxxxxxxxxxx`，非真实 Key、非本次文件）。
- **.gitignore**：`apps/api/scripts/verify-*.js` 通配符（`:68`）覆盖 9.4/9.5a/9.5b 验证脚本，均 ignored。

---

## 10. 给 Codex 的回报摘要

- **结论**：**Go**（P0=0 / P1=0 / P2=0，标准 Gate 建议复审通过）。
- **三条须知悉项全部落地**：① `continue_debate→running(r2)` 已实现并实测（verify S2.1/S3.1）；② `max_rounds` 每轮重校验双闸（Moderator + Orchestrator 防御闸）已实现，第 4 轮不派发（S1.6）；③ `advance_round` 也经 `running` 节点派发 round-2（S3.1）。
- **round-2 mock debater**：冲突启发式（本轮 ≥2 high-risk opinion → `continue_debate`）+ phase='debate' 确定性派发，不依赖真实模型（moderator.ts:75-106,149；queue.service.ts:181,258）。
- **多轮循环**：`[running→summarized]*→(completed|aborted)` 闭环，round≥2 派发 `debate` phase，currentRound 正确推进（verify S1 三轮回合、S2 两轮回合全 PASS）。
- **max_rounds 兜底**：`maxRounds=3` 硬闸每轮重校验，到顶 `force_stop→aborted`（S1.3/S1.6）。
- **未越界**：零 schema 变更、零前端改动、零真实 LLM、P2+ 均未触碰（§8）。
- **验证全绿**：tsc(api+web) 双 0 errors；Docker Postgres healthy；`verify-9.5b-multiround.js` **22/22**；standing `smoke-runtime.js` **31/31**；密钥扫描净（exit=1）。
- **建议提交入库**：✅ 建议 —— 3 源码文件 +（本次新增）`Sprint_9.5b_MultiRound_Debate_Backend.md` +（滚动）`ACTIVE_SPRINT.md`；verify 脚本已被 gitignore，不入库。
- **P1 收官状态**：9.5b 为 P1 最后一仗，round-2 + 多轮 + max_rounds 兜底全部落地，P1（脊柱 + 多轮地基 + 多轮回合）完成；后续 P2（真 LLM Moderator / ModelAdapter）/ P3（Memory·Prompt）/ P4（Tool·HITL）进入下一阶段。

> 实现副作用（仅供参考，不影响交付）：为跑 smoke 启动/恢复 Docker Desktop + `docker compose up -d` + API server（`node dist/main.js` 后台 :4000）；`nest build` 刷新 dist（gitignore）。如需释放资源可由 Codex/你侧停相关进程。
