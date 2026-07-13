# Sprint 9.1 — Workbuddy Review（Fast-Gate，独立复审）

> **Reviewer**：workbuddy-review（独立上下文，未采信 workbuddy-docs 自检 / Codex 协调结论；全部对磁盘 + git 实际状态取证）
> **模式**：快速 Gate（仅查 P0 / P1）
> **复审对象**：
> - `docs/coordination/Sprint_9.1_Orchestrator_Spine_Contract.md`（新增主文档）
> - `docs/coordination/ACTIVE_SPRINT.md`（滚动到 9.1）
> **基线**：9.0 Go（`bbed578`）+ main = `bbed578`（fast-forward 验证已最新）
> **日期**：2026-07-13
> **职责边界**：Codex 已裁决 Contract 3 项关键决策（Prisma delta 落 `ReviewTurn` / `Review.status` 7 值 + `interrupted`/`archived` 保留 / mock Moderator 硬闸默认值）——均接受，本次只审文档合规性与忠实度，不重审决策合理性。

---

## 结论：**Go**

全部 6 项必查通过，未发现 P0 阻塞项，未发现 P1。

---

## 证据（5 条）

### 证据 1 — 三连查 + 变更范围仅 docs/ + schema.prisma 未被修改（必查项 1）

**取证命令**
```
git rev-parse --show-toplevel  → D:/workspace/PrismReview            ✅ 项目根
git remote -v                  → origin = feather100/PrismReview.git ✅
git pull --ff-only origin main → Already up to date；git rev-parse --short HEAD → bbed578  ✅ 基线
git diff --name-only           → docs/coordination/ACTIVE_SPRINT.md
git ls-files --others --exclude-standard → docs/coordination/Sprint_9.1_Orchestrator_Spine_Contract.md
git status --porcelain | grep -E '\.(ts|tsx|prisma|env)$|node_modules|/data/|\.reasonix|\.workbuddy|log' → 无命中
git diff -- apps/api/prisma/schema.prisma          → 空输出（无 diff）
git diff -- 'apps/api/**/reviews.service.ts'        → 空输出（无 diff）
```

**看到**：tracked 改动仅 `ACTIVE_SPRINT.md`；untracked 仅 `Sprint_9.1_*.md`；宽口径扫描对 `.ts/.tsx/.prisma/.env/node_modules/data/.reasonix/.workbuddy/log` 零命中；`schema.prisma` 与 `reviews.service.ts` **无 diff（未被修改）**。

**判断**：变更范围严格限定 `docs/`；Contract 只**描述** schema delta 与目标状态机，**未实施**——`schema.prisma`（现有）与状态机实现 `REVIEW_STATUS_FLOW` 均原封未动。符必查项 1，无 P0。

---

### 证据 2 — fast-gate §7.1 五条件全满足（必查项 2）

**取证**：`git diff --name-only` 仅 `ACTIVE_SPRINT.md`；`git diff schema.prisma` / `reviews.service.ts` 空；`package.json`、`apps/`、`packages/` 无改动。

| §7.1 条件 | 磁盘实情 | 结论 |
|---|---|---|
| 1. 不改 Prisma schema | `git diff schema.prisma` 空 | 满足 |
| 2. 不改状态机实现 | `reviews.service.ts` 无 diff（`REVIEW_STATUS_FLOW` 未改） | 满足 |
| 3. 不接真实 LLM/Embedding/MinIO | 无模型调用、无依赖 | 满足 |
| 4. 不改前端主页面 | 无 `.tsx`/前端改动 | 满足 |
| 5. 不引入新依赖 | `package.json` 未变 | 满足 |

**判断**：§13.1 自检表与磁盘实情一致，确有资格走 fast-gate（非仅凭文档自述）。

---

### 证据 3 — 忠实于 9.0 架构权威（三项决策 + P1 范围，必查项 3）

**取证**：读 Contract 全文，对照 `docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md` §2/§12。

- 决策 1（TS+自研 graph runtime，不引 `@langchain/langgraph` 全量）：§2「自研 TS graph runtime」+ §2.4 NodeCtx 注入，原样承接，未弱化。
- 决策 2（LLM Moderator + 硬闸脊柱）：§5 四闸齐列 `max_rounds/max_tokens_per_review/max_cost_per_review/max_turns_per_reviewer`（+ `min_rounds` 收敛 override）+ 决策审计表；P1 mock Moderator（§5.1）符 9.0 §4.6。
- 决策 3（P1 先行）：§9.2 显式「`AgentRuntime` worker 抽取归 P6，P1 不做进程抽取」，先固编排脊柱，与 9.0 一致。
- §12 P1 范围含 round-2 mock debater：Contract §10 完整落地（默认 mock、确定性触发、`max_rounds` 兜底）。

**判断**：三项决策与 P1 范围均忠实承接，无弱化/改写，P0「决策被改写」不成立。

---

### 证据 4 — Contract 具体非空泛，且 delta 忠实于现有 schema（必查项 4）

**取证 A（具体类型齐备）**：Contract 给出 `Node`/`StaticEdge`/`ConditionalEdge`/`Graph`（§2.1）、`ReviewState`/`TurnRecord`/`UsageLedger`（§2.2）、`Checkpointer`/`Checkpoint`（§2.3）、`NodeCtx`（§2.4）；7 状态机 + 全部流转 + 终态（§1）；幂等键 `(review_id, reviewer_id, round)`（§3.2）；Moderator `ModeratorDecision`/`RuleCheckResult` shape + 硬闸默认值 `max_rounds=3`/`max_turns_per_reviewer=3`/`min_rounds=1`（§5.2）；`ReviewCheckpoint`/`ModeratorDecision` Prisma 定义（§6/§7.5）。均为具体 TS/Prisma 类型，非空泛。

**取证 B（delta 基于真实现状）**：核 `apps/api/prisma/schema.prisma`（现有）与 `reviews.service.ts:9`：
- `REVIEW_STATUS_FLOW` 实为 9 值 `draft/diagnosing/ready/running/interrupted/summarizing/completed/failed/archived` — 与 Contract §1/§7.6「现有 9 值」描述**逐字一致**。
- `ReviewTurn` 现有字段 `id/reviewId/turnIndex/phase/roleVersionId/status/startedAt/completedAt/createdAt` — 与 §7.2「既有字段保留」清单**完全吻合**；新增 `round`/`idempotencyKey`/`schemaVersion` 为增量列。
- `ReviewOpinion` 现有字段与 §4.1/§7.3 描述一致；`Review` 现有字段与 §7.4「既有保留」一致，新增 `currentRound`/`currentNodeId`。

**判断**：Contract 具体且 delta 忠实于磁盘现状，非凭空杜撰，无 P1 空泛缺陷。

---

### 证据 5 — API 契约保留/Gate 声明/滚动正确 + 密钥零命中 + 红线（必查项 5、6）

**取证 A（Contract 声明）**：
- §8 显式声明 Report API / SSE / `setup-demo-review` 行为不变 + 前端零改动 + 仅新增内部接口。
- §9.2 显式「`AgentRuntime` worker 抽取 = P6，P1 不做进程抽取」。
- §13.2 显式「⚠️ 9.2 实现走**标准 Gate**（动 schema+状态机，触发 §5.2/§5.4+§7.1，不得 fast-gate）」。

**取证 B（ACTIVE_SPRINT 滚动，`git diff`）**：Current Sprint `9.0→9.1`；Phase=`P1 Orchestrator Spine Contract`；Gate=`In Progress`；Last Updated=`2026-07-13`；Owner=`workbuddy-docs`。Gate 表：9.0 行 `In Progress→**Go**（bbed578，已推送）`；新增 **9.1 In Progress** 行（含「9.2 实现将走标准 Gate」）。✅

**取证 C（密钥 + 红线）**：
```
grep -Eon 'sk-[A-Za-z0-9]{10,}'     → none
grep -Eon 'Bearer [A-Za-z0-9]{20,}' → none
grep -Eon 'pris[A-Za-z0-9*]{3,}'    → none
```
两文件零真实密钥命中。`git status` 无 commit；全程未 `git commit`/`git push`/`--force`；落点正确（主文档 `docs/coordination/`）。

**判断**：API 契约保留、Gate 分层声明、滚动字段与 Gate 表全部正确；密钥零命中；红线满足。必查项 5/6 通过。

---

## 备注（非阻塞 / P2 留档）

- Contract §1.2 状态机把非规范补充态 `interrupted`/`archived` 与 7 值规范集并列描述，语义清晰、符合 Codex 裁决（7 值 + 两态保留），非瑕疵。
- `ACTIVE_SPRINT.md` 的 LF→CRLF 警告属 `.gitattributes` 行尾规范化，非内容问题，不阻塞。
- 本次仅查 P0/P1；P2 措辞细节未展开，留档即可。

---

## 给 Codex 的回报

- **Go / No-Go**：**Go**
- **证据条数**：5
- **是否建议提交入库**：建议提交（9.1 Contract 主文档 + ACTIVE_SPRINT 一并入库，走 fast-gate 收尾）
- **是否建议进入 9.2 实现**：建议进入——但 **9.2 必须走标准 Gate**（Contract §13.2 已声明：动 Prisma schema + 状态机实现，触发 §5.2/§5.4+§7.1，不得 fast-gate），实现须附 §12 验证证据（tsc 0 errors + smoke round-1/round-2 mock debater + 幂等/硬闸/checkpoint/审计）并由 Codex 裁决。
