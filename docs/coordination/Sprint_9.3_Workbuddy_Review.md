# Sprint 9.3 — Workbuddy 独立 Gate 复审（标准 Gate）

> **Reviewer**: workbuddy-review（独立上下文，未采信 workbuddy-coder 证据文档自述或 Codex 协调核验；tsc(api+web) / migration / smoke / psql idempotencyKey **全部独立重跑**）
> **模式**: **标准 Gate**（非 fast-gate —— 动 Prisma schema 枚举 + 状态机实现 `REVIEW_STATUS_FLOW` + 前端，触发协议 §5.4 + §7.1）
> **复审对象**: Sprint 9.3 — P1 枚举重命名 + 前后端引用更新 + idempotencyKey 回填修正（workbuddy-coder 实现）
> **基线**: 9.2 Go / main = `ad5c6cf`
> **日期**: 2026-07-13
> **结论**: ✅ **Go**（无 P0；1 项 P1 非阻塞 + 1 项 P2 备注）

---

## 0. 三连查（强制，P0 前置）

| 项 | 命令 | 观测 | 判断 |
|---|---|---|---|
| 根目录 | `git rev-parse --show-toplevel` | `D:/workspace/PrismReview` | ✅ |
| remote | `git remote -v` | `origin = https://github.com/feather100/PrismReview.git` | ✅ |
| 状态 | `git status --short` | 7 改（schema + reviews.service + 5 前端）+ `M ACTIVE_SPRINT.md` + `?? Sprint_9.3_Enum_Migration_Backend.md` | ✅ 恰好 7 代码 + 2 文档 |
| 基线 | `git pull --ff-only origin main` + `rev-parse --short HEAD` | `Already up to date` / `ad5c6cf` | ✅ |

---

## 1. 结论

**Go** —— 8 项必查全过，无 P0；1 项 P1（前端 live UI 未端到端渲染，代码逻辑已独立核实正确，非阻塞）；1 项 P2（idempotencyKey 消歧行 4 段键形态，9.4 需知悉）。建议 Codex 提交入库，并进入 9.4（标准 Gate）。

---

## 2. P0 / P1 / P2 清单（每条附独立取证）

### P0 项（必阻塞）—— 全部未触发 ✅

| # | 检查点 | 证据（命令/文件/行号） | 观测 | 严重度 |
|---|---|---|---|---|
| P0-1 | 变更范围恰好 7 改 + 2 文档，无 `.env`/`node_modules`/`data`/`.reasonix`/`.workbuddy`/日志 | `git status --short`；`git status --porcelain \| grep -iE '\.(env)$\|node_modules\|/data/\|...'` → 无命中 | 范围干净 | 无 P0 |
| P0-2 | 未越界 9.4（无 graph runtime/Checkpointer/Moderator/round-2/checkpoint 写入）；`queue.service.ts` 本 Sprint 未改 | `git status --porcelain \| grep -iE 'orchestrat\|checkpoint\|moderator\|graphruntime'` → 无；`git diff -- queue.service.ts` → 空输出 | 严格停在枚举+引用+回填 | 无 P0 |
| P0-3 | 枚举映射正确（§7.6 权威）：`@default("draft")`→`@default("created")`，新增 `aborted`，注释更新为新 9 值 | `git diff -- schema.prisma`：`status @default("created") // created\|diagnosed\|running\|summarized\|completed\|failed\|aborted\|interrupted\|archived` | 映射与 §7.6 一致（`ready→diagnosed` 非 created，采信 §7.6 而非 §1.1 笔误） | 无 P0 |
| P0-4 | 旧字面量零残留 | `git grep -nE "'(draft\|diagnosing\|summarizing)'" -- apps/api/src apps/web/src` → **exit 1（零）**；`git grep -nE "'ready'" -- apps/api/src/modules/reviews/` → **exit 1（零）** | 后端+前端旧枚举彻底清除 | 无 P0 |
| P0-5 | `knowledge.service` `'ready'` 保留且为 Knowledge 模型（未误改） | 读 `knowledge.service.ts:74-77` = `prisma.knowledgeDocument.update({data:{status:'ready'}})`；`:182-187` 同为 `knowledgeDocument`（值域 indexing/ready） | 属 `KnowledgeDocument.status`，与 Review 独立，正确未改 | 无 P0（open ② 见 §4） |
| P0-6 | `REVIEW_STATUS_FLOW` 重写忠实 §1.2 | `git diff reviews.service.ts:9-24`：`created→[diagnosed]`、`diagnosed→[running]`、`running→[summarized,interrupted,failed]`、`summarized→[running,completed,aborted,failed]`、`interrupted→[running]`、`completed/failed/aborted/archived→[]`；6 处 `status:`写入 + `assertReview` 断言全更新为新值 | 流转覆盖 round-2(summarized→running)/收敛(→completed)/硬闸(→aborted)/HITL(interrupted→running) | 无 P0 |
| P0-7 | idempotencyKey 历史行 0 PK（**9.3 强制验收项**） | 独立 psql（修正正则，排除中间段 roleVersionId UUID 误匹配）：`WHERE idempotency_key ~ '::<uuid>$'` → **0 行**；shape 分布 = 282 `::round` + 72 `::round::disambig`，**PK_STYLE=0**；抽样键 = `reviewId::roleVersionId::1` | 0 行 PK，验收通过 | 无 P0（open ④ 见 §4） |
| P0-8 | tsc api+web 0 errors；无真实密钥；未三连查 | 见 §3（tsc 双 0）+ §2 P1-区（密钥）+ §0 | —— | 无 P0 |

### P1 项（可登记，Gate 裁决是否阻塞）

| # | 检查点 | 证据 | 观测 | 判断 + 严重度 |
|---|---|---|---|---|
| P1-1 | 前端 live UI 渲染未端到端验证 | 沙箱无浏览器 / 未起 web dev server；已独立重跑 `apps/web tsc --noEmit` = **exit 0** 且逐文件读 5 前端 diff 逻辑（折叠子态/标签/SSE 门控/过滤器/报告守卫全部映射正确） | 代码逻辑正确，但 DiagnosisPage 的 `created+data` 折叠子态、MeetingHeader 新标签等**未在真实浏览器渲染确认** | **P1（非阻塞）**——与 coder 自标「待补：前端 live 渲染人工验收」一致；建议 Codex 或后续在有浏览器环境补一次人工验收，不阻塞 9.3 Go |

### P2 项（留档不阻塞）

| # | 检查点 | 证据 | 观测 | 判断 |
|---|---|---|---|---|
| P2-1 | idempotencyKey 消歧行为 4 段键（非纯 `::1$`） | psql shape 分布：72 行为 `reviewId::roleVersionId::1::<n>`（4 段），源于 18 组 demo 重跑重复 `(review_id,role_version_id,round=1)`；纯 `::1` 会破 UNIQUE，故加确定性 `::<n>` 消歧 | 第三段仍是语义 round（非 PK），UNIQUE 完好、0 NULL、0 数据丢失；符合 §5「0 行 PK」核心验收；但严格 `::1$` 格式未 100% 满足（合理，因遗留重复数据） | **P2（非阻塞）**——9.4 运行时幂等键写入统一 `::round`，须知悉历史消歧行为 `::round::<n>` 形态（幂等查询按新键匹配不受影响）；建议写入 9.4 Contract 备注 |

---

## 3. 独立重跑验证证据（不照抄 coder）

| 验证 | 命令 | 独立重跑结果 | 与 coder 声明比对 |
|---|---|---|---|
| tsc api | `cd apps/api && npx tsc --noEmit --incremental false` | `exit 0`，0 errors | 一致 |
| **tsc web（open ①）** | `cd apps/web && npx tsc --noEmit` | **`exit 0`，0 errors** | 一致（coder 声明 0，独立证实） |
| 迁移状态 | `npx prisma migrate status`（apps/api） | `3 migrations found` + `Database schema is up to date!`（含 `20260713142000_9_3_enum_rename_and_idempotency`） | 一致 |
| 迁移 SQL 安全 | 读 `migrations/20260713142000_.../migration.sql` | ① `ALTER COLUMN status SET DEFAULT 'created'`；② 数据 remap（仅触旧值，CASE WHEN，幂等）；③ idempotencyKey 重写语义键 + 消歧；`status` 是 text 列非原生 PG enum → 无 DROP VALUE/数据丢失风险 | 一致 |
| psql — reviews 旧状态值 | `SELECT count(*) FROM reviews WHERE status IN ('draft','diagnosing','ready','summarizing')` | **0** | 一致 |
| psql — reviews 新分布 | `SELECT status,count(*) FROM reviews GROUP BY status` | diagnosed 100 / completed 95 / running 62 / created 33 | 一致（§4.5） |
| psql — PK 形态键（open ④） | `SELECT count(*) WHERE idempotency_key ~ '::<uuid>$'` | **0** | 一致（0 行 PK） |
| psql — 键形态分布 | CASE shape GROUP BY | 282 `::round` + 72 `::round::disambig`，PK=0 | 一致（282+72=354） |
| psql — UNIQUE/NULL | dup groups / NULL count | **0 / 0** | 一致 |
| 冒烟 Runtime | `node scripts/smoke-runtime.js` | **31/31 passed**（exit 0） | 一致（首跑因 API dev server 未运行报连接 0，启动 `node dist/main.js`(:4000 就绪) 后重跑全绿——环境问题非代码缺陷） |
| 冒烟 Route A | `node scripts/setup-demo-review.js` | mock_fallback，exit 0 | 一致 |
| 冒烟 Route B | `node scripts/setup-demo-review.js --with-runner` | db_opinions，exit 0 | 一致 |
| 回归 providerSummary | `curl .../report \| grep providerSummary` | `{"totalTurns":3,"bySource":{"mock":3}}` = Mock(3)，hasRealProvider false | 一致，未破 |
| 新 review 枚举 + 新键 | psql 查 Route B review | status=`completed`（走完新枚举流）；新 3 turns 键均 `reviewId::roleVersionId::1`（语义键，无回归） | ✅ 新写入正确 |
| 密钥扫描 | `git grep -nE 'sk-[A-Za-z0-9]{10,}\|Bearer [A-Za-z0-9]{20,}' -- apps/ scripts/ docs/` | 唯一命中 `Sprint_5.0` 文档掩码示例 `sk-xxxxxxxxxxxxxxxx`（历史既有，非真实、非本次文件） | 一致，零真实 Key |

> Docker 全栈（postgres/redis/minio）沙箱 `Up (healthy)`；API 服务经本 reviewer 启动 `node dist/main.js`（含 9.3 编译产物）后 :4000 就绪，具备完整重跑条件——上述均**本会话实跑**。前端仅 tsc 层验证（无浏览器，见 P1-1）。

---

## 4. 四个 open 项的独立结论

| # | Open 项 | 独立结论 |
|---|---|---|
| ① | apps/web tsc 是否 0 errors | ✅ **0 errors** —— `cd apps/web && npx tsc --noEmit` 独立重跑 exit 0 |
| ② | knowledge.service `ready` 核实 | ✅ **属 `KnowledgeDocument.status`（值域 indexing/ready），与 `Review.status` 完全独立** —— 读 `knowledge.service.ts:74-77`（`prisma.knowledgeDocument.update`）+ `:182-187` 确认；正确未改，未越界破坏 Knowledge 模型 |
| ③ | draft/diagnosing 折叠后前端子态区分方案 | ✅ **合理** —— 用非 status 信号 `data`（`getDiagnosis` 返回的诊断结果）区分：`created` 且无 `data`→原 draft（显"开始诊断"，按钮守卫 `status==='created' && !data`）；`created` 且有 `data`→原 diagnosing（显"诊断中"，`nextActionText = data ? '诊断中' : '开始诊断'`）；`diagnosed`→原 ready（显"确认评审团"）。代码注释明确引用 Codex 指令 2；诊断为同步 mock，`created+data` 仅极短瞬态，方案对边界安全兜底 |
| ④ | idempotencyKey DB 实证全语义键 0 PK | ✅ **0 行 PK，验收通过** —— 独立 psql：PK 形态（末段 UUID）0 行；282 纯 `::round` + 72 `::round::disambig`（消歧行第三段仍为语义 round，见 P2-1）；UNIQUE 完好、0 NULL；新写入（Route B smoke）3 turns 均语义键 `::1` |

---

## 5. 红线 + 数据迁移安全 + 滚动

- **红线**：未 `git commit`/`push`/`--force`（HEAD 仍 `ad5c6cf`，7 代码 + 2 文档均本地）；落点正确（`docs/coordination/`）；mock 模式（`.env:20` `MODEL_PROVIDER="mock"`、`:21` `ALLOW_EXTERNAL_MODEL_CALLS=false`，真实 Key 注释态），零真实密钥（见 §3）。✅
- **数据迁移安全**：`Review.status` 为 Prisma `String`(text) 列**非原生 PG 枚举**——§7.6 担忧的 ADD/DROP VALUE、被引用不能删、事务外操作**风险不存在**；迁移实为「改列默认值 + 数据 UPDATE」，无数据丢失；三段 UPDATE 均幂等（重跑无差异，WHERE 仅命中旧值 / 键按 review_id+role+round 重算）；无 DELETE，重复行消歧保留；`migrate status` up to date。✅
- **ACTIVE_SPRINT 滚动**：Current Sprint=9.3 / Phase=P1 Enum Migration + Ref Update / Gate=In Progress(标准 Gate) / Last Updated=2026-07-13 / Owner=workbuddy-coder；Gate 表 9.2 `In Progress→Go`(`ad5c6cf`)、9.3 新增 In Progress 行。✅

---

## 6. 给 Codex 的回报

- **Go / No-Go**：**Go**（无 P0；P1-1 非阻塞、P2-1 备注）
- **P0 / P1 / P2 条数**：P0=0 / P1=1 / P2=1
- **四个 open 项独立结论**：① apps/web tsc **0 errors**（独立重跑）；② knowledge.service `ready` = **KnowledgeDocument.status，正确未改**；③ draft/diagnosing 折叠方案 **合理**（用 `data` 非 status 信号区分）；④ idempotencyKey **0 行 PK，验收通过**（282 `::round` + 72 消歧 `::round::<n>`，UNIQUE 完好）
- **是否建议提交入库**：**建议** —— 一并提交 7 代码 + `ACTIVE_SPRINT.md` + `Sprint_9.3_Enum_Migration_Backend.md`；迁移 SQL 仍被 `.gitignore` L34 忽略（既有约定，同 9.2）
- **是否建议进入 9.4**：**建议进入，标准 Gate** —— 9.4 范围 = graph runtime（Node/Edge/ReviewState/Checkpointer）+ ReviewOrchestrator + MockModerator + round-2 debate + checkpoint 写入/resume；**必须**附 §6.3 验证证据（tsc + 迁移 + 幂等/硬闸/checkpoint/审计/round-2 smoke）；并**知悉 P2-1**：9.4 运行时幂等键写入须统一 `::round`，历史消歧行 `::round::<n>` 形态不影响新键匹配，建议写入 9.4 Contract 备注；建议补一次前端 live UI 人工验收（P1-1）

---

> 本复审文档由 workbuddy-review 独立产出，**未执行 `git commit`**，待 Codex 裁决后提交 + 推送。
