# Sprint 9.5b — P1 收官（round-2 + 多轮 + max_rounds 兜底）· Workbuddy 独立复审

- **模式**：标准 Gate（行为变更，动业务代码，不动 schema / 不动前端）
- **复审对象**：Sprint 9.5b — P1 收官（在 9.5a 多轮地基上实现 round-2 mock debater + continue_debate 冲突检测 + 多轮 `running→summarized` 循环 + max_rounds 每轮兜底）
- **基线**：9.5a Go / main = `12a6d3a`
- **复审日期**：2026-07-14
- **复审 Agent**：workbuddy-review（独立上下文，未采信 coder 证据文档 / Codex 协调核验，所有结论自查磁盘·git·代码·DB）
- **三连查**：toplevel=`D:/workspace/PrismReview` ✓ / remote origin=`https://github.com/feather100/PrismReview.git` ✓ / status 仅 9.5b 范围 ✓ / pull `--ff-only` Already up to date ✓

---

## 结论：**Go** — P0 = 0 / P1 = 0 / P2 = 0

P1 收官仗在 9.5a 多轮地基上完整落地：round-2 mock debater（确定性 high-risk 冲突检测 + debate phase 派发）、多轮循环（`advance_round`/`continue_debate` → running 派发 round-N）、max_rounds=3 双闸兜底（Moderator `force_stop` + Orchestrator 防御闸 → aborted）。9.5a review §8 三条须知悉项全部闭合，无 P2+ 越界，无 9.4/9.5a 行为回退。

---

## 变更范围 + 边界（必查项 1）

| 检查 | 命令 / 证据 | 观测 | 判断 |
|---|---|---|---|
| 变更文件范围 | `git status --short` | `M moderator.ts` / `M review-orchestrator.ts` / `M queue.service.ts` / `M ACTIVE_SPRINT.md` / `?? Sprint_9.5b_MultiRound_Debate_Backend.md`；`.gitignore` 无 diff（通配符 `verify-*.js` 已在 9.5a 加）；verify 脚本被 gitignore | 恰好预期范围 |
| schema.prisma 未动 | `git diff --name-only apps/api/prisma/schema.prisma` → 空；`git diff --stat` 空 | 9.5b 零迁移 | ✓ 未越 P0 |
| apps/web 未动 | `git diff --name-only apps/web` → 空 | 前端零改动 | ✓ 未越 P0 |
| 无 P2+ 越界 | `command grep -nE 'ModelAdapter|MemoryService|PromptService|ToolCall|HITL|openai|anthropic'` orchestrator + queue | 命中仅为 `graph-runtime.ts` 既有 **类型声明/接口占位**（9.4 已存在、9.5b 未改）：`ModelAdapter`/`MemoryService`/`PromptService` 可选 NodeCtx 字段 + 注释；3 个改动文件**无任何实现** | ✓ 未越 P0 |
| 三连查 | 见顶 | 全过 | ✓ |

---

## 三条须知悉项落地（9.5a review §8，必查项 2 / 3 / 4 / 5 / 6）

| 须知悉项 | 代码证据 | 独立验证 |
|---|---|---|
| **① `continue_debate → running(r2)`** | `review-orchestrator.ts`：`routeAfterSummarized` 的 `advance_round`/`continue_debate` 现返 `running`（由 9.5a 的 `summarized` 改）；`handleTurnsComplete` 新增 `next==='running'` 分支 → `nextRound=state.round+1` + `enqueue('review.start',{round:nextRound})` | verify S2.1 / S3.1 PASS（派发 round-2，`currentRound=2`，`status=running`）+ S1.3 PASS |
| **② `max_rounds` 每轮重校验双闸** | `moderator.ts`：`round >= gates.maxRounds → force_stop`；`review-orchestrator.ts`：派发前 `if (nextRound > gates.maxRounds) → aborted`（防御闸）。双闸满足 Contract §5.3「每转移前校验」 | verify S1.1（到顶→aborted）/ S1.6（第 4 轮不派发）/ S1.3（末轮 `force_stop`）PASS |
| **③ `advance_round` 也派发 round-2** | `routeAfterSummarized` 统一 `advance_round`/`continue_debate → running`，`handleTurnsComplete` 二者均走 `currentRound++` + round-N 派发 | verify S3.1 PASS（`minRounds=2` 使 round-1 返 `advance_round`，仍派发 round-2） |

**多轮闭环正确性（必查项 3）**：
- `queue.service.ts`：`jobId` 带 `.r${round}`（防 round 串扰）；`phase: round>=2?'debate':'round_robin'`；`checkMeetingComplete`/`executeMeetingComplete` 均按 `review.currentRound` 过滤 terminal count，且 `meeting.complete` jobId 带 `.r${currentRound}`。
- 独立验证：verify S1.2（`currentRound=3`）、S1.4（turn round 含 1/2/3）、S1.5（round≥2 派发 `phase=debate`）、S1.7（每轮 `running`/`summarized` checkpoint + `aborted` 终态）全部 PASS。

**round-2 mock debater（必查项 4）**：
- `moderator.ts`：`detectConflict(reviewId, round)` 读 DB 本轮 turn 的 opinion，统计 `riskLevel==='high'` 条数，≥2 → `conflict → continue_debate`；确定性、不依赖真实模型、`max_cost_per_review=0`。
- 独立验证：verify S1.3（continue_debate×2）/ S2.2（round-1 决策 continue_debate）/ S2.4（continue_debate→converge）PASS。

**round-scoped 正确性（必查项 5，关键回归点）**：
- jobId 含 round 标签 → 多轮任务不串扰（verify S1.6 无越界派发 + 真实 DB 三轮回合各自独立）。
- `checkMeetingComplete` 按 `currentRound` 过滤 → round-N 完成才触发当前轮 completionHook（verify S1.7 每轮独立 checkpoint 序列 `running/summarized` ×3 + `aborted`）。
- idempotencyKey 与 round 一致（verify S1.12 PASS；真实 DB Route A 三 turn 均为 `reviewId::roleVersionId::1` 规范形）。

---

## 独立重跑验证证据

| 验证 | 命令 | 结果 |
|---|---|---|
| 后端类型 | `cd apps/api && npx tsc --noEmit --incremental false` | **0 errors** ✓ |
| 前端类型 | `cd apps/web && npx tsc --noEmit` | **0 errors** ✓ |
| 迁移状态 | `npx prisma migrate status` | Database schema is up to date（3 migrations，9.5b 零迁移 → schema 未动实证）✓ |
| 9.5b 验证脚本 | `node apps/api/scripts/verify-9.5b-multiround.js` | **22/22 PASS**（S0×4 / S1×12 / S2×5 / S3×1）✓ |
| 运行时冒烟 | `node scripts/smoke-runtime.js` | **31/31 PASS** ✓ |
| 端到端 A（HTTP 脊柱） | `node scripts/setup-demo-review.js` | review `a6237e41…` → **completed**，checkpoints `[running,summarized,completed]`，`converge(passed=true)`，单轮（mock 无≥2 high-risk，符合预期）✓ |
| 端到端 B（legacy runner） | `node scripts/setup-demo-review.js --with-runner` | review `2a0290d7…` → **completed**（legacy 直写 Prisma，严格 round 校验不破）✓ |
| 密钥扫描 | `git grep -nE 'sk-…|Bearer …' -- apps/api/src apps/api/scripts` | **零真实命中**（exit=1）✓ |
| 默认 mock | `apps/api/.env` | `MODEL_PROVIDER="mock"` / `ALLOW_EXTERNAL_MODEL_CALLS=false` ✓ |
| 审计（真实 DB） | `reviewCheckpoint` / `moderatorDecision` 查询 | A：per-node checkpoint + `converge` 行 `ruleCheckResult.passed=true`；verify S1.8/S2.5 一致 PASS ✓ |

> 真实 DB 证据（独立查询）：Route A `a6237e41…` = `status=completed` / `currentRound=1` / `turns(r1×3, round_robin)` / `checkpoints[running#1,summarized#2,completed#3]` / `moderatorDecisions[1:converge/passed=true]` / idempotencyKey 全为 3 段规范形。Route B `2a0290d7…` = `status=completed` / `checkpoints[running]` / 无 Moderator 决策（legacy 路径，符合「B 不破」）。

---

## 4 个 open 项独立结论

1. **三条须知悉项是否真实生效（continue_debate 路由 / max_rounds 双闸 / advance_round 派发）** → **✓ 全部生效**
   - ① `continue_debate→running(r2)`：代码 `routeAfterSummarized` 返 `running` + `handleTurnsComplete` `running` 分支派发 round-N；verify S2.1/S3.1 + 真实 DB 实证。
   - ② `max_rounds` 双闸：Moderator `round>=maxRounds→force_stop` + Orchestrator `nextRound>maxRounds→aborted`；verify S1.1/S1.6 实证第 4 轮不派发。
   - ③ `advance_round` 派发 round-2：与 continue_debate 统一路由；verify S3.1 实证（`minRounds=2` 仍派发）。

2. **多轮闭环是否正确（round-1→2→3→completed/aborted，currentRound 推进，debate phase，round-scoped jobId 防串扰）** → **✓ 正确**
   - verify S1.1（`aborted`）/ S1.2（`currentRound=3`）/ S1.4（round 1,2,3）/ S1.5（round≥2 `phase=debate`）/ S1.7（每轮 `running`/`summarized` checkpoint + `aborted`）全部 PASS；jobId `.r${round}` 防串扰（S1.6 无越界）。

3. **max_rounds=3 兜底是否真停（第 4 轮不派发→force_stop→aborted）** → **✓ 真停**
   - verify S1.1（`status=aborted`）+ S1.6（无 round≥4 turn）+ S1.3（决策序列 `continue_debate×2 + force_stop`）实证；双闸任一触发即 aborted，无无限辩论。

4. **无 P2+ 越界（无真 LLM/ModelAdapter/Memory/Prompt/Tool/HITL/schema/前端改动）** → **✓ 未越界**
   - schema 零迁移（migrate status up to date）；前端零改动；`command grep` 仅命中 `graph-runtime.ts` 既有类型声明（9.4 已有、9.5b 未改），3 个改动文件无 P2+ 实现；默认 mock，无真实 LLM 调用。

---

## P0 / P1 / P2 清单

### P0（必阻塞 No-Go）— 0 条
- 无：schema 未动、前端未动、无 P2+ 越界、三条须知悉项均落地、多轮无串扰（jobId round-scoped）、第 4 轮不派发（max_rounds 兜底生效）、tsc 双 0、密钥干净、三连查完成。

### P1（可登记，Gate 裁决）— 0 条
- 无：须知悉项无小偏差，verify 覆盖 S0/S1/S2/S3 全链路 + 单轮回归 + 双轮收敛 + advance_round 派发 + 幂等 3/4 段 + 审计 + checkpoint，边界 case 完备。

### P2（留档不阻塞）— 0 条
- 无结构性留档项。仅两点观察（非缺陷，不计入判定）：
  - `detectConflict` 阈值为「本轮 ≥2 条 high-risk」，属 P1 mock 确定性启发式（Contract §10 授权），非真模型；9.5b 范围正确，真 LLM Moderator 留 P2 路线图。
  - `review.checkpoints` 每轮多行（sequence 递增），与 9.4/9.5a 一致，属正常 per-node 记录。

---

## 红线核对（必查项 7）
- schema 未动 ✓（migrate status up to date，零迁移）
- 前端未动 ✓（git diff apps/web 空）
- 无 P2+ 越界 ✓（grep 仅命中既有类型声明）
- 9.4/9.5a 行为不破 ✓（smoke 31/31、Route A 单轮 converge 不破、Route B legacy 不破、verify S0 单轮回归 PASS）
- 多轮串扰防护 ✓（jobId round-scoped + checkMeetingComplete 按 currentRound 过滤）
- max_rounds 兜底 ✓（双闸，第 4 轮不派发）
- tsc 双 0 ✓
- 密钥干净 ✓（git grep 零真实命中）
- 三连查完成 ✓
- 未 git commit/push/force ✓（落点正确，待 Codex 决策）

---

## 给 Codex 的回报
- **Go / No-Go**：**Go**（P0=0 / P1=0 / P2=0）
- **4 open 项**：① 三条须知悉项全部生效 ✓；② 多轮闭环正确（currentRound 推进 + debate phase + round-scoped 防串扰）✓；③ max_rounds=3 兜底真停（第 4 轮不派发→force_stop→aborted）✓；④ 无 P2+ 越界 ✓
- **建议提交入库**：✅ 建议 —— 3 源码 + `ACTIVE_SPRINT.md` + `Sprint_9.5b_MultiRound_Debate_Backend.md`；verify 脚本已被 `verify-*.js` 通配符 gitignore，不入库。
- **P1 收官确认**：✅ 建议确认 —— round-2 + 多轮循环 + max_rounds 兜底已在 P1 范围内完整闭环，可正式收官 P1 并进入 P2 路线图（真 LLM Moderator / ModelAdapter 泛化 / Memory·Prompt Service / Tool·HITL 等按 Contract 既定边界推进）。

> 复审副作用说明：本 reviewer 启动 `docker compose`（Postgres 当时仍在线）、`node dist/main.js`（后台 :4000）以重跑 smoke 与 Route A/B，并 `nest build` 刷新 dist（dist 已 gitignore，不入库）；可酌情释放。复审文档已落盘**未 commit**。
