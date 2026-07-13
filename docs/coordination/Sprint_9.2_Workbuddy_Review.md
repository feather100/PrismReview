# Sprint 9.2 — Workbuddy 独立 Gate 复审（标准 Gate）

> **Reviewer**: workbuddy-review（独立上下文，未采信 workbuddy-coder 证据文档自述或 Codex 协调结论；tsc / migration / smoke **独立重跑**）
> **模式**: **标准 Gate**（非 fast-gate —— 动 Prisma schema，触发协议 §5.4 + §7.1 退回标准流程）
> **复审对象**: Sprint 9.2 — P1 加性 Schema 迁移（workbuddy-coder 实现）
> **基线**: 9.1 Go / main = `10cec39`
> **日期**: 2026-07-13
> **结论**: ✅ **Go**（无 P0；1 项 P1 carryover + 1 项 P2 备注，均不阻塞 9.2）

---

## 0. 三连查（强制，P0 前置）

| 项 | 命令 | 观测 | 判断 |
|---|---|---|---|
| 根目录 | `git rev-parse --show-toplevel` | `D:/workspace/PrismReview` | ✅ |
| remote | `git remote -v` | `origin = https://github.com/feather100/PrismReview.git` | ✅ |
| 状态 | `git status --short` | `M schema.prisma` / `M queue.service.ts` / `M ACTIVE_SPRINT.md` / `M run-agent-turns-for-review.js` / `?? Sprint_9.2_Schema_Migration_Backend.md` | ✅ 恰好 4 改 + 1 新，与预期一致 |
| 基线 | `git pull --ff-only origin main` + `git rev-parse --short HEAD` | `Already up to date` / `10cec39` | ✅ |

---

## 1. 结论

**Go** —— 6 项必查全过，无 P0 阻塞项；1 项 P1（idempotencyKey 历史回填语义，carryover 至 9.3）、1 项 P2（迁移 SQL gitignored，项目既有约定）。建议 Codex 提交入库，并进入 9.3（标准 Gate）。

---

## 2. P0 / P1 / P2 清单（每条附独立取证）

### P0 项（必阻塞）—— 全部未触发 ✅

| # | 检查点 | 证据（命令/文件/行号） | 观测 | 严重度 |
|---|---|---|---|---|
| P0-1 | 变更范围仅 4 改 + 1 新，无 `.env`/`node_modules`/`data`/`.reasonix`/`.workbuddy`/日志 | `git status --short`；`git diff --name-only`；宽口径 `git status --porcelain \| grep -E '\.(ts\|tsx\|prisma\|env)$\|node_modules\|/data/\|...'` → 仅 `apps/api/prisma/schema.prisma`、`queue.service.ts`、`ACTIVE_SPRINT.md`、`scripts/run-agent-turns-for-review.js` + untracked 证据文档 | 无业务外/密钥/日志变更；未跟踪仅 `docs/` | 无 P0 |
| P0-2 | schema 加性 only：无删列、无改列类型、无枚举增删改 | `git diff -- apps/api/prisma/schema.prisma`（54 添 / 5 删）；逐行审 5 删 = `Review` 模型关系块 `tenant/creator/turns/opinions/report` 5 行**重排对齐**（为新增长 `checkpoints/moderatorDecisions` 反向关系腾出对齐），纯缩进重排；全 diff 无任何 `enum`、无 `@db` 类型变更、无列删除 | 加性成立；5 删良性 | 无 P0 |
| P0-3 | `reviews.service.ts` 状态机实现未改 | `git diff -- apps/api/src/modules/reviews/reviews.service.ts` → 空输出；`REVIEW_STATUS_FLOW` 原样（9 值流保留） | 状态机未动，符合 9.2 红线 | 无 P0 |
| P0-4 | 未越界实现 9.3 范围（graph runtime / Moderator / round-2 / checkpoint 写入） | `git status --porcelain \| grep -iE 'orchestrat\|checkpoint\|moderator\|graphruntime'` → 无新模块；`queue.service.ts` diff 仅 `reviewTurn.create` 加 `round`/`idempotencyKey` 两字段，无新调度逻辑；`review_checkpoints`/`moderator_decisions` 表已建但**零写入**（coder §5.3 复核 + 本次 `SELECT count(*) FROM review_checkpoints` 环境侧为 0） | 严格停在加性 schema，未碰运行时 | 无 P0 |
| P0-5 | 无真实密钥 / 未接真实 LLM | `git grep -nE 'sk-[A-Za-z0-9]{10,}\|Bearer [A-Za-z0-9]{20,}' -- apps/api scripts docs/` → 唯一命中 `Sprint_5.0` 文档 `sk-xxxx` 掩码示例（历史既有，非真实 Key）；`pris` 命中均为 `prismreview`/`prisma` 项目名；`.env` 行 20-23 `MODEL_PROVIDER="mock"`、`ALLOW_EXTERNAL_MODEL_CALLS=false`、真实 Key 字段注释态 | mock 模式，零真实密钥 | 无 P0 |
| P0-6 | tsc 0 errors（独立重跑，不依赖 DB） | `cd apps/api && npx tsc --noEmit --incremental false` → `exit 0`，无输出 | 0 errors | 无 P0 |
| P0-7 | 已执行三连查 | 见 §0 | ✅ | 无 P0 |

### P1 项（可登记，Gate 裁决是否阻塞）

| # | 检查点 | 证据 | 观测 | 判断 + 严重度 |
|---|---|---|---|---|
| P1-1 | `idempotencyKey` 历史回填用行 PK 作第三段（非语义键） | `cat apps/api/prisma/migrations/20260713121800_.../migration.sql` 回填行：`UPDATE review_turns SET idempotency_key = review_id \|\| '::' \|\| role_version_id \|\| '::' \|\| id WHERE idempotency_key IS NULL`；本次独立核验新写入行 `SELECT idempotency_key FROM review_turns WHERE review_id='e5879583...'` → 3 行均为 `{reviewId}::{roleVersionId}::1`（语义键，非 PK） | 历史 324 行键为 `...::<pk>`，新写入为 `...::1`；**语义不一致** | **P1 carryover（独立确认，与 Codex 预判一致）**——见 §4 |

### P2 项（留档不阻塞）

| # | 检查点 | 证据 | 观测 | 判断 |
|---|---|---|---|---|
| P2-1 | 迁移 SQL 被 `.gitignore` 忽略，不入库 | `.gitignore:34` = `apps/api/prisma/migrations/`（git status 未列 `.gitignore` 为改动 → 既有约定，非 9.2 新引入）；init 迁移同被忽略 | 迁移 SQL 仅存本地 + coder 证据文档；`schema.prisma`（VCS 源真相）已入库 | **P2（非阻塞）**——任务 P1 触发条件为「9.2 新引入该忽略」；此处为既有约定，不触发 P1。建议 Codex 就「迁移可复现性」做一次性决策（9.3 起提交 migrations，或确认项目统一用 `prisma migrate dev`/shadow DB 生成） |

---

## 3. 独立重跑验证证据（不照抄 coder）

| 验证 | 命令 | 独立重跑结果 | 与 coder 声明比对 |
|---|---|---|---|
| tsc | `cd apps/api && npx tsc --noEmit --incremental false` | `exit 0`，0 errors | 一致 |
| 迁移状态 | `npx prisma migrate status`（apps/api） | `2 migrations found` + `Database schema is up to date!` | 一致（up to date） |
| 冒烟 Runtime | `node scripts/smoke-runtime.js` | **31/31 passed, 0 failed**（exit 0） | 一致（31/31） |
| 冒烟 Route A | `node scripts/setup-demo-review.js` | Review 创建/诊断/选角(CTO,CFO,PMO)/启动；Report src `mock_fallback`；exit 0 | 一致 |
| 冒烟 Route B | `node scripts/setup-demo-review.js --with-runner` | `Running agent turns...` → `mock provider, turns completed`；Report src `db_opinions`；**exit 0** | 一致（B 已修复通过） |
| 报告回归 | `curl .../report \| grep providerSummary` | `"providerSummary":{"totalTurns":3` → 仍 `Mock(3)` | 一致，未破 |
| 写入点键校验 | `docker exec psql ... SELECT idempotency_key FROM review_turns WHERE review_id='e5879583...'` | 3 行均为 `{reviewId}::{roleVersionId}::1`（语义键） | 证实 run-agent-turns 第二写入点修复真实生效 |

> Docker 全栈（postgres/redis/minio）在沙箱 `Up (healthy)`，API 服务 `:4000` 在线，具备完整重跑条件——上述均**本会话实跑**，非引用 coder 文档。

---

## 4. 对 Codex 预判的 idempotencyKey P1 —— 独立严重度结论

**独立结论：P1 carryover（与 Codex 预判一致，但给出独立依据与 9.3 强制条件）。**

- **事实**：历史 324 行 `review_turns` 的 `idempotency_key` 回填用了行 PK 作第三段（`{reviewId}::{roleVersionId}::{id}`）；新写入（queue.service.ts / run-agent-turns 两处）均使用 Contract 语义键 `{reviewId}::{roleVersionId}::{round}`。本次已独立核验两者。
- **为何非 P0（不阻塞 9.2）**：
  1. 9.2 范围**明确不含幂等行为**——幂等 skip 逻辑属 9.3 runtime；9.2 的义务仅是「让 `idempotency_key` 列满足 `NOT NULL + UNIQUE` 约束」，已通过「先加可空列 → 回填 → SET NOT NULL」安全三步完成，零数据丢失。
  2. 新数据键正确（已核验），约束满足，系统端到端不破（Route B 重跑 exit 0）。
  3. 该不一致**仅影响 pre-9.2 历史行**，且**仅在 9.3 真正启用按 idempotencyKey 查询的幂等逻辑后才会暴露**。
- **为何仍是 P1（须 carryover）**：一旦 9.3 实现「按 `idempotencyKey` findFirst 跳过既有 turn」，对某条 pre-9.2 老 review 重跑 round-1 时，runtime 计算语义键 `...::1` 但老行键为 `...::<pk>` → 查不到 → 重复建 turn → 老 review 失去幂等保护。此缺口若不补，会升级为 9.3 的 P0。
- **给 9.3 的强制验收条件（写进 9.3 Contract / Gate 证据）**：9.3 标准 Gate 必须证明历史行已处理，二选一：
  - (a) 将历史 `review_turns.idempotency_key` 回填/改写为语义键 `{reviewId}::{roleVersionId}::1`；或
  - (b) 9.3 幂等查询对 PK 后缀键兼容（如 `WHERE (review_id, role_version_id, round) = (...)` 或同时匹配两种键形态）。
  未满足任一条件即不得判 9.3 Go。

---

## 5. Contract 忠实度（§2.2 交叉核对）

逐字段对齐 `Sprint_9.1_Orchestrator_Spine_Contract.md` §6 / §7.2–7.5，实现**无偏差、无超声明字段**：

| Contract 声明 | 实现（schema.prisma diff） | 结论 |
|---|---|---|
| §6 `ReviewCheckpoint`：`id/reviewId/nodeId/stateJson/sequence/createdAt` + `@@unique([reviewId,sequence])` + `@@index([reviewId])` + `@@map("review_checkpoints")` + `review` 关系 | 完全一致 | ✅ |
| §7.5 `ModeratorDecision`：`id/reviewId/round/decisionType/reasoning/ruleCheckResult/createdAt` + `@@index([reviewId,round])` + `@@map("moderator_decisions")` + `review` 关系 | 完全一致（含 `reasoning String`） | ✅ |
| §7.2 `ReviewTurn` 加：`round Int @default(1)` / `idempotencyKey String @unique` / `schemaVersion String @default("1.0")` | 完全一致 | ✅ |
| §7.3 `ReviewOpinion` 加：`schemaVersion String @default("1.0")` / `round Int?` | 完全一致 | ✅ |
| §7.4 `Review` 加：`currentRound Int @default(1)` / `currentNodeId String?` + 反向关系 `checkpoints`/`moderatorDecisions` | 完全一致 | ✅ |

实现**未猜测** Contract 未声明字段、**未改** Contract 指定类型。忠实度满分。

---

## 6. 红线 + 迁移安全 + 滚动

- **红线**：未 `git commit` / `git push` / `--force`（4 文件本地改动 + 1 证据文档，均未提交）；落点正确（`docs/coordination/`）；mock 模式，零真实密钥（见 P0-5）。✅
- **迁移安全**：`migration.sql` 纯加性（ADD COLUMN / CREATE TABLE / CREATE INDEX / AddForeignKey），无 DROP/ALTER TYPE/DELETE；`idempotency_key` 三步「可空 → 回填 → SET NOT NULL」顺序安全，无数据丢失。✅
- **ACTIVE_SPRINT 滚动**：Current Sprint=9.2 / Phase=P1 Additive Schema Migration / Gate=In Progress(标准 Gate) / Last Updated=2026-07-13 / Owner=workbuddy-coder；Gate 表 9.1 `In Progress→Go`（`10cec39`）、9.2 新增 In Progress 行。✅

---

## 7. 给 Codex 的回报

- **Go / No-Go**：**Go**（无 P0；P1-1 carryover 不阻塞；P2-1 备注）
- **P0 / P1 / P2 条数**：P0=0 / P1=1 / P2=1
- **idempotencyKey 回填独立严重度**：**P1 carryover**（与预判一致），附 9.3 强制验收条件（见 §4）
- **是否建议提交入库**：**建议** —— 一并提交 4 个业务/文档改动 + `Sprint_9.2_Schema_Migration_Backend.md` 证据文档；注意迁移 SQL 仍被 `.gitignore` 忽略（既有约定，见 P2-1）
- **是否建议进入 9.3**：**建议进入，标准 Gate** —— 9.3 范围 = §7.6 枚举迁移 + `REVIEW_STATUS_FLOW` 重写 + graph runtime + Moderator 运行时 + round-2/checkpoint 写入逻辑；**必须**在标准 Gate 下附 §6.3 验证证据（tsc 0 + 迁移 + 幂等/硬闸/checkpoint/审计 smoke），并**满足 §4 的 idempotencyKey 历史行处理条件**，否则不得判 Go

---

> 本复审文档由 workbuddy-review 独立产出，**未执行 `git commit`**，待 Codex 裁决后提交 + 推送。
