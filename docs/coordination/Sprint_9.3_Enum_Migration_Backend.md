# Sprint 9.3 — P1 枚举重命名 + 前后端引用更新 + idempotencyKey 回填修正（实现记录）

> **Owner**: workbuddy-coder ｜ **Gate**: 标准 Gate（待 `workbuddy-review` 复审）｜ **基线 main**: `ad5c6cf` ｜ **Last Updated**: 2026-07-13
> **状态**: 代码 + 证据就绪，**未执行 `git commit` / `push`**（标准 Gate 红线）。

---

## 0. 三连查（开工记录）

| 检查 | 结果 |
|---|---|
| `git rev-parse --show-toplevel` | `D:/workspace/PrismReview` ✓ |
| `git remote -v` | `origin = https://github.com/feather100/PrismReview.git` ✓ |
| `git status --short` | clean ✓ |
| `git pull --ff-only origin main` | Already up to date ✓ |
| HEAD | `ad5c6cf`（基线正确）✓ |

---

## 1. 范围（Scope In）

按 Contract §7.6（权威）物理重命名 `Review.status` 枚举 + 前后端引用更新 + 修正 9.2 遗留的 idempotencyKey 回填。**用户明确选择接受打破「前端零改动」**，故本 Sprint 一并改前端。

### 1.1 枚举映射（§7.6 权威）

| 旧值 | 新值 |
|---|---|
| `draft` | → `created` |
| `diagnosing` | → `created`（折叠） |
| `ready` | → `diagnosed` |
| `summarizing` | → `summarized` |
| `running` / `completed` / `failed` | 沿用 |
| `interrupted` / `archived` | 保留（非规范补充态） |
| （新增） | `aborted`（硬闸 / 收敛 override 强停） |

新枚举 9 值 = `created | diagnosed | running | summarized | completed | failed | aborted | interrupted | archived`（7 规范 + interrupted + archived）。

---

## 2. Codex 指令落实

### 指令 1 — §1.1 笔误已识别
Contract §1.1 第 21 行写 `created` 覆盖 `draft+diagnosing+ready`，与 §7.6 的 `ready→diagnosed` 矛盾。**按指令以 §7.6 为权威**：`ready→diagnosed`（非 created）。数据迁移、后端、前端全部按 §7.6 执行。

### 指令 2 — draft/diagnosing 折叠后的前端区分方案
折叠后 `draft` 与 `diagnosing` 都是 `created`，DiagnosisPage 失去 status 区分能力。

**采用方案：用非 status 信号 `data`（`DiagnosisResponse`，经 `getDiagnosis` 单独获取）区分**：
- `status === 'created'` **且无** `data`（诊断结果不存在）→ 旧 `draft` 语义 → 显示「开始诊断」按钮；
- `status === 'created'` **且有** `data`（诊断结果已存在）→ 旧 `diagnosing` 语义（瞬态边界）→ 显示「诊断中」loading；
- `status === 'diagnosed'` → 旧 `ready` 语义 → 显示「确认评审团」。

**理由**：`ReviewResponse` DTO 本身不含 `diagnosis` 字段，但 DiagnosisPage 已通过 `getDiagnosis` 单独拉取 `data`，这是天然的「诊断是否完成」信号，无需改 API/DTO 即可精确还原两个子态。诊断为同步 mock（`diagnose()` 一次调用内 created→写 diagnosis→diagnosed），`created + data` 仅在极短瞬态窗口出现，方案对该边界安全兜底。

### 指令 3 — `knowledge.service.ts` 的 `'ready'` 核实结论
读 `knowledge.service.ts:76/184/187` 上下文确认：**该 `'ready'` 写在 `knowledgeDocument` 模型（`KnowledgeDocument.status`，值域 `pending_review` / `indexing` / `ready`），与 `Review.status` 完全独立。** 按指令 3，**属 Knowledge 模型，不得改（越界）**——本 Sprint 未触碰 `knowledge.service.ts`。

### 指令 4 — idempotencyKey 历史回填修正（强制验收项）
9.2 历史行用行 PK（`review::role::<uuid>`）作 idempotencyKey，非语义键。9.3 在数据迁移中重写为语义键 `${reviewId}::${roleVersionId}::${round}`（既有行 round=1）。**验收结果见 §4.5：0 行用 PK，全部语义键。**

### 指令 5 — 未越界 9.4 范围
**未实现**：graph runtime（Node/Edge/ReviewState/Checkpointer）、ReviewOrchestrator 模块、MockModerator、round-2 debate、checkpoint 写入 / resume 逻辑、opinion schema 运行时校验。9.3 仅做「枚举重命名 + 引用更新 + 回填修正」，现有 `queue.service` 流程用新枚举值继续跑，行为不变（除枚举名）。

---

## 3. 代码改动清单

| 文件 | 改动 |
|---|---|
| `apps/api/prisma/schema.prisma` | `Review.status` 默认值 `@default("draft")` → `@default("created")`；枚举注释更新为新 9 值 |
| `apps/api/prisma/migrations/20260713142000_9_3_enum_rename_and_idempotency/migration.sql` | 新迁移（gitignored，本地审，全文见 §5） |
| `apps/api/src/modules/reviews/reviews.service.ts` | `REVIEW_STATUS_FLOW` 重写为 P1 流转；6 处 status 写入 / assert 旧值 → 新值 |
| `apps/web/src/app/reviews/page.tsx` | `isDraft→isCreated`、`isReady→isDiagnosed`；过滤器 `{value:'draft'/'ready'}` → `created`/`diagnosed`；标签更新 |
| `apps/web/src/features/diagnosis/DiagnosisPage.tsx` | draft/diagnosing 折叠子态方案（指令 2）；ready→diagnosed；step / 按钮 / 分支重写 |
| `apps/web/src/features/meeting/MeetingPage.tsx` | SSE 使能条件 + 非会议态判断改新枚举 |
| `apps/web/src/features/meeting/components/MeetingHeader.tsx` | 新枚举值中文标签（created/diagnosed/summarized/aborted） |
| `apps/web/src/features/report/ReportPage.tsx` | 未开始判断 `draft/ready/running` → `created/diagnosed/running` |

> **重要发现（比任务假设更安全）**：`Review.status` 是 Prisma `String`（Postgres `text` 列 + 注释列枚举值），**并非原生 PG 枚举**。故 §7.6 担心的「枚举值 ADD/DROP VALUE、被引用不能删、事务外操作」**风险根本不存在**——迁移实为「改列默认值 + 数据 UPDATE」，无数据丢失风险。`prisma migrate diff` 确认唯一 schema delta 就是 `ALTER COLUMN "status" SET DEFAULT 'created'`。

### 3.1 REVIEW_STATUS_FLOW 重写（Contract §1.2）

```
created    → [diagnosed]
diagnosed  → [running]
running    → [summarized, interrupted, failed]
summarized → [running, completed, aborted, failed]   // round-2 / 收敛 / 硬闸 / 失败
interrupted→ [running]                                 // resume()
completed / failed / aborted / archived → []          // 终态
```

> 注：`REVIEW_STATUS_FLOW` 为**文档常量**（`git grep` 确认未被运行时消费），实际闸口是各 `assertReview(allowedStatuses)` 调用——已同步更新为同一 P1 规范。

---

## 4. 验证证据（标准 Gate，协议 §6.3 + §9.6，全实跑）

### 4.1 tsc（强制）
| 命令 | 结果 |
|---|---|
| `cd apps/api && npx tsc --noEmit --incremental false` | **exit 0 · 0 errors** ✓ |
| `cd apps/web && npx tsc --noEmit` | **exit 0 · 0 errors** ✓ |

### 4.2 Docker
`docker ps`：`prismreview-postgres` / `prismreview-redis` / `prismreview-minio` 均 **Up (healthy)** ✓

### 4.3 migration apply
`pnpm exec prisma migrate deploy` → `20260713142000_9_3_enum_rename_and_idempotency` 应用成功 ✓

### 4.4 编译产物核验
`dist/modules/reviews/reviews.service.js`：含新枚举值 `created/diagnosed/summarized/aborted`，**无** `draft/diagnosing/summarizing` 残留 ✓

### 4.5 idempotencyKey 回填验证（强制验收项）
迁移 + 路线 A/B 冒烟后复核（`$queryRaw` 实查）：

| 指标 | 结果 | 期望 |
|---|---|---|
| reviews 旧状态值行数 | **0** | 0 ✓ |
| reviews 新状态分布 | diagnosed 100 / completed 95 / running 62 / created 33 | 全新枚举 ✓ |
| **PK 风格 idempotency_key 行数** | **0** | **0（核心验收）** ✓ |
| 不符语义格式行数 | **0** | 0 ✓ |
| 重复 idempotency_key 组 | **0** | 0（UNIQUE 完好）✓ |
| review_turns 总行数 | 354 = 282 精确 `::1` + 72 消歧 `::1::N` | 无数据丢失 ✓ |

> **消歧说明**：18 组重复 `(review_id, role_version_id, round)`（demo 重跑产物，均 round=1）无法全用 `::1`（会破 UNIQUE）。方案：每组按 `id` 排序，首行 `::1`，后续 `::1::<n>`（n 从 1 起，0-based ordinal）。**均为语义键格式（非 PK）、保留全部数据、UNIQUE 安全**。9.4 运行时幂等键写入将统一为 `::round`，历史消歧行不影响新逻辑（idempotency 检查按新键匹配）。

### 4.6 smoke 三路（全绿）
| 路线 | 命令 | 结果 |
|---|---|---|
| runtime | `node scripts/smoke-runtime.js` | **31/31 passed** ✓ |
| A（纯 mock） | `node scripts/setup-demo-review.js` | `Report src: mock_fallback`；status 全程新枚举（created→diagnosed→running）✓ |
| B（runner + DB） | `node scripts/setup-demo-review.js --with-runner` | `Report src: db_opinions`；`providerSummary: {totalTurns:3, bySource:{mock:3}, hasRealProvider:false}`（= Mock(3)）✓ |

回归：Report API 返回 ✓、SSE 可连（smoke #13/#14/#15）✓、路线 B 实写 DB opinions ✓。前端渲染：tsc 0 errors + 折叠子态逻辑（指令 2）已实现，待 live UI 人工确认（沙箱无浏览器，标**待补：前端页面 live 渲染人工验收**）。

### 4.7 状态机自检
- `git diff reviews.service.ts` 含 `REVIEW_STATUS_FLOW` 重写为新流转 ✓
- `git grep -nE "'(draft|diagnosing|summarizing)'" -- apps/api/src apps/web/src` → **零命中**（exit 1）✓
- `git grep -nE "'ready'" -- apps/api/src apps/web/src`（排除 knowledge）→ **零命中**（exit 1）✓

---

## 5. 迁移 SQL 全文（gitignored，本地审阅入口）

> `apps/api/prisma/migrations/` 被 `.gitignore` L34 忽略（init / 9.2 迁移同约定），故迁移 SQL 以本文档 + 本地文件为审阅入口。

```sql
-- 1) Schema delta（status 是 text 列，非原生 PG 枚举，无 DROP VALUE 风险）
ALTER TABLE "reviews" ALTER COLUMN "status" SET DEFAULT 'created';

-- 2) Review.status 数据 remap（§7.6，仅触碰旧值，幂等）
UPDATE "reviews"
SET "status" = CASE "status"
  WHEN 'draft'       THEN 'created'
  WHEN 'diagnosing' THEN 'created'
  WHEN 'ready'       THEN 'diagnosed'
  WHEN 'summarizing' THEN 'summarized'
  ELSE "status"
END
WHERE "status" IN ('draft', 'diagnosing', 'ready', 'summarizing');

-- 3) ReviewTurn.idempotency_key：PK 风格 → 语义键 review::role::round，
--    重复组按 id 排序加 ::<n> 消歧（保 UNIQUE，不删数据，幂等）
UPDATE "review_turns" t
SET "idempotency_key" = base.rev || '::' || base.rv || '::' || base.rnd
                         || CASE WHEN base.cnt > 1 THEN '::' || (base.rn - 1) ELSE '' END
FROM (
  SELECT "id",
    "review_id"::text AS rev, "role_version_id"::text AS rv,
    COALESCE("round", 1)::text AS rnd,
    row_number() OVER (PARTITION BY "review_id","role_version_id",COALESCE("round",1) ORDER BY "id") AS rn,
    count(*)     OVER (PARTITION BY "review_id","role_version_id",COALESCE("round",1))               AS cnt
  FROM "review_turns"
) base
WHERE t."id" = base."id" AND t."idempotency_key" IS NOT NULL;
```

**迁移安全自检**：① `status` 非原生枚举 → 无 DROP VALUE / 数据丢失风险；② 所有 UPDATE 幂等（重跑不产生差异）；③ 无 DELETE，重复行消歧保留；④ 无 `prisma migrate` 数据丢失警告（`migrate deploy` 直接成功）。

---

## 6. 显式声明：未做（9.4 范围）

**本 Sprint 未实现以下（属 9.4，未越界）**：graph runtime（Node/Edge/ReviewState/Checkpointer）、ReviewOrchestrator 模块、MockModerator、round-2 debate、checkpoint 写入 / resume 逻辑、opinion schema 运行时校验。`REVIEW_STATUS_FLOW` 中 `summarized→running`（round-2）、`→aborted`（硬闸）等流转已在**状态机声明**层就位，但**运行时触发逻辑**留待 9.4。

---

## 7. 红线核对表

| 红线 | 状态 |
|---|---|
| 标准 Gate（附 tsc/smoke 证据） | ✓ 已附（§4） |
| 默认 mock，未调真实 LLM / 未启 LM Studio / paid API | ✓（providerSummary hasRealProvider:false） |
| 未写密钥（`git grep sk-/Bearer`） | ✓ 唯一命中是旧文档 `Sprint_5.0` 的脱敏示例占位符 `sk-xxxxxxxxxxxxxxxx`（非真实 Key、非本次改动文件） |
| 未提交 `.env`/`node_modules`/`data`/`.reasonix`/`.workbuddy`/日志 | ✓ |
| 未 `--force` | ✓（未做任何 git 写操作） |
| 未伪造证据（跑不了如实标「待补」） | ✓（前端 live 渲染标待补） |
| 未 `git commit`（HEAD 仍 `ad5c6cf`） | ✓ |
| 枚举映射按 §7.6（ready→diagnosed） | ✓ |
| knowledge.service 的 ready 已核实（Knowledge 模型，不改） | ✓ |
| idempotencyKey 历史行全语义键（0 行 PK） | ✓ |
| 未越界 9.4（graph/Moderator/round-2/checkpoint） | ✓ |

---

## 8. 给 Codex 的回报要点

- **改动文件**：7 个（schema + reviews.service + 5 前端）+ 1 迁移 SQL（gitignored）+ 本证据文档 + ACTIVE_SPRINT 滚动。
- **tsc**：api + web 均 0 errors。
- **migration / smoke / idempotencyKey**：全实跑通过（Docker 全栈 healthy，回填 0 行 PK，冒烟三路全绿）。
- **draft/diagnosing 折叠方案**：用 `data`（DiagnosisResponse）非 status 信号区分（§2 指令 2）。
- **knowledge.service 核实**：`'ready'` 属 `KnowledgeDocument.status`，未改（未越界）。
- **越界**：无。
- **建议**：走 **workbuddy-review 标准 Gate**。重点复审：① 枚举 remap 数据正确性（§4.5）；② idempotencyKey 消歧策略（重复行 `::1::N` 是否符合 review 对「语义键」的验收口径）；③ 前端折叠子态方案（`created + data` 边界）；④ status 非原生枚举这一发现对 9.4 的影响。
- **待补**：前端页面 live UI 渲染人工验收（沙箱无浏览器）。
```