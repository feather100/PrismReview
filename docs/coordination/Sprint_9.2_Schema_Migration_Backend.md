# Sprint 9.2 — P1 加性 Schema 迁移（Backend）

> **Owner**: workbuddy-coder
> **Gate**: 标准 Gate（standard Gate，§13.2 声明）—— 代码 + 证据就绪，回报 Codex，由 `workbuddy-review` 复审后推进。
> **Baseline main**: `10cec39`
> **Last Updated**: 2026-07-13
> **Commit**: **未提交**（本 Sprint 按标准 Gate 红线，仅在本地产出代码 + 本证据文档，不执行 `git commit` / `git push`）

---

## 0. 摘要

本 Sprint 是 P1 后端实现的**第一跳**，严格限定为**加性（additive-only）schema 迁移**。在 `10cec39` 基线之上：

- 新增 2 张表（`ReviewCheckpoint`、`ModeratorDecision`）；
- 既有表 `ReviewTurn` / `ReviewOpinion` / `Review` 仅**新增列**（全部带 `@default` 或 nullable，零破坏性）；
- 生成 Prisma 迁移 `20260713121800_add_orchestrator_spine_schema` 并在本地 Postgres 实跑（`migrate deploy`）；
- 回填历史 324 行 `review_turns`（保证 NOT NULL + UNIQUE 约束可被满足）；
- 修复 2 个 `reviewTurn.create` 写入点（含 1 个任务原假设遗漏的 standalone runner 脚本），使加性约束下系统不破；
- tsc 0 errors；Docker 全栈（postgres/redis/minio）实跑；seed + 3 路冒烟（runtime / route A / route B）全绿。

**未做（明确属于 9.3）**：§7.6 枚举迁移、`REVIEW_STATUS_FLOW` 重写、graph runtime、Moderator 运行时、round-2 / checkpoint 恢复逻辑。

---

## 1. 范围与边界（Codex 拆分）

| 项 | 归属 | 本次是否实施 |
|---|---|---|
| 新表 `ReviewCheckpoint` | 9.2 | ✅ |
| 新表 `ModeratorDecision` | 9.2 | ✅ |
| `ReviewTurn` 加 `round` / `idempotencyKey` / `schemaVersion` | 9.2 | ✅ |
| `ReviewOpinion` 加 `schemaVersion` / `round` | 9.2 | ✅ |
| `Review` 加 `currentRound` / `currentNodeId` + 反向关系 | 9.2 | ✅ |
| Prisma 迁移 + 历史回填 | 9.2 | ✅ |
| §7.6 枚举迁移（`ReviewStatus` / `TurnPhase` 等枚举改写） | **9.3** | ❌ 未做 |
| `REVIEW_STATUS_FLOW` 重写 | **9.3** | ❌ 未做（见 §6 红线自检） |
| graph runtime / Moderator 运行时 | **9.3** | ❌ 未做 |
| round-2 / checkpoint resume 逻辑 | **9.3** | ❌ 未做（`ReviewCheckpoint` 表仅建好，未写入） |

---

## 2. 加性 Delta 清单（映射到 Contract）

映射自 `Sprint_9.1_Orchestrator_Spine_Contract.md` §6 / §7.2–7.5。

### 2.1 新表 — `ReviewCheckpoint`（Contract §6）
```prisma
model ReviewCheckpoint {
  id        String   @id @default(uuid()) @db.Uuid
  reviewId  String   @map("review_id") @db.Uuid
  nodeId    String   @map("node_id")
  stateJson String   @map("state_json")
  sequence  Int
  createdAt DateTime @default(now()) @map("created_at")
  review Review @relation(fields: [reviewId], references: [id])
  @@unique([reviewId, sequence])
  @@index([reviewId])
  @@map("review_checkpoints")
}
```

### 2.2 新表 — `ModeratorDecision`（Contract §5.1 / §7）
```prisma
model ModeratorDecision {
  id              String   @id @default(uuid()) @db.Uuid
  reviewId        String   @map("review_id") @db.Uuid
  round           Int      @map("round")
  decisionType    String   @map("decision_type")
  reasoning       String
  ruleCheckResult Json     @map("rule_check_result")
  createdAt       DateTime @default(now()) @map("created_at")
  review Review @relation(fields: [reviewId], references: [id])
  @@index([reviewId, round])
  @@map("moderator_decisions")
}
```

### 2.3 `ReviewTurn` 加列（Contract §7.2）
- `round Int @default(1) @map("round")`
- `idempotencyKey String @unique @map("idempotency_key")`  // `${reviewId}::${roleVersionId}::${round}`
- `schemaVersion String @default("1.0") @map("schema_version")`

### 2.4 `ReviewOpinion` 加列（Contract §7.3）
- `schemaVersion String @default("1.0") @map("schema_version")`
- `round Int? @map("round")`（nullable，向后兼容历史意见）

### 2.5 `Review` 加列 + 反向关系（Contract §7.4 / §7.5）
- `currentRound Int @default(1) @map("current_round")`
- `currentNodeId String? @map("current_node_id")`
- 反向关系 `checkpoints ReviewCheckpoint[]` 与 `moderatorDecisions ModeratorDecision[]`

> 全部新增列均为 `@default` 或 nullable，**不触发既有行的破坏性变更**——符合加性迁移安全规则。唯一例外是 `idempotencyKey`：无默认值且 `@unique`，迁移中用「先加可空列 → 回填 → 再 `SET NOT NULL`」三步走（见 §3）。

---

## 3. 迁移安全自检（三步走 + 回填）

迁移 SQL：`apps/api/prisma/migrations/20260713121800_add_orchestrator_spine_schema/migration.sql`
（**注意**：`apps/api/prisma/migrations/` 被 `.gitignore` L34 忽略，历史 `init` 迁移同样未入库；故本迁移 SQL 以本证据文档 + 本地文件为审阅入口，符合项目既有约定，未强行改动 `.gitignore`。）

关键回填逻辑（针对 `review_turns`）：
```sql
ALTER TABLE "review_turns" ADD COLUMN "idempotency_key" TEXT,
ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "schema_version" TEXT NOT NULL DEFAULT '1.0';

-- 历史 324 行含重复 (review_id, role_version_id) 组（setup-demo-review 重跑所致），
-- 故用行主键 id 作第三拼接段，保证 UNIQUE 不被破坏。
UPDATE "review_turns" SET "idempotency_key" = "review_id"::text || '::' || "role_version_id"::text || '::' || "id"::text WHERE "idempotency_key" IS NULL;

ALTER TABLE "review_turns" ALTER COLUMN "idempotency_key" SET NOT NULL;
```

> 9.2 仅要求约束可被满足；幂等校验逻辑本身属 9.3 runtime 范畴。`idempotencyKey` 历史值只需满足 `NOT NULL + UNIQUE`，无需语义正确。

---

## 4. 写入点修复（加性约束的连带修复）

加性迁移使 `idempotencyKey` / `round` 成为 `reviewTurn` 写入的**必需项**，因此所有 `reviewTurn.create` 写入点都必须补齐——否则系统破。

| 文件 | 行 | 状态 | 说明 |
|---|---|---|---|
| `apps/api/src/modules/reviews/queue/queue.service.ts` | 216 | ✅ 已修复 | 任务原假设「唯一 create 站点」，已补 `round: 1` + `idempotencyKey: \`${reviewId}::${roleVersionId}::1\`` |
| `scripts/run-agent-turns-for-review.js` | 159 | ✅ **本次新发现并修复** | 任务原 Grep 仅覆盖 `src/`，遗漏此 standalone runner 脚本（`--with-runner` 路线 B 即走此路径）。首次 route B 跑测即报 `Invalid prisma.reviewTurn.create()`，正是加性约束命中第二处写入点。已补 `round: 1` + `idempotencyKey`（同公式） |

> **诚实声明**：任务原始假设「`queue.service.ts` 是唯一 `ReviewTurn` create 站点（Grep 确认）」不完整——Grep 范围限于 `src/`，漏掉 `scripts/` 下的 runner 脚本。该遗漏由冒烟回归（route B）暴露并修复，属加性迁移的必然连带修复，不引入任何运行时/业务行为变更。

`reviewOpinion.create`（runner 内）无需改动：`schemaVersion` 有 `@default`，`round` 为 nullable。

---

## 5. 验证证据（实跑，非伪造）

### 5.1 tsc（强制 0 error）
- 命令：`pnpm --filter api exec tsc --noEmit --incremental false`
- 结果：**exit 0，0 errors**（clean rebuild `dist/main.js` 已含 §4 修复）。

### 5.2 Docker / 迁移
- 本地 Docker 全栈 `Up (healthy)`：prismreview-postgres / prismrevire-redis / prismreview-minio。
- `prisma migrate deploy`：**All migrations have been successfully applied**（`20260713121800_add_orchestrator_spine_schema`）。
- `prisma migrate status`：**Database schema is up to date!**（2 migrations found）。

### 5.3 回填完整性（raw SQL 复核）
| 检查项 | 期望 | 实际 |
|---|---|---|
| `review_turns` 总行数 | 324（历史）+ 新 demo | 324 → 冒烟后 336 |
| `idempotency_key IS NULL` | 0 | **0** |
| `idempotency_key` 重复组 | 0 | **0** |
| `review_opinions.schema_version` 非空 | 0 null | **0 null**（252 → 264） |
| `review_checkpoints` 行数 | 0（9.2 不写） | **0** |
| `moderator_decisions` 行数 | 0（9.2 不写） | **0** |
| `reviews` 新列 `current_round`/`current_node_id` | 存在 | **存在** |
| `review_turns` 新列 `round`/`idempotency_key`/`schema_version` | 存在 | **存在** |
| `review_opinions` 新列 `round`/`schema_version` | 存在 | **存在** |

### 5.4 Seed
- `pnpm prisma:seed`：✅ 5 preset roles / tenant / mock user upsert 成功（仅角色/租户/用户，不触碰 review 数据，基线未损）。

### 5.5 冒烟回归（3 路全绿）
| 路线 | 命令 | 结果 |
|---|---|---|
| Runtime | `node scripts/smoke-runtime.js` | ✅ **31/31 passed**（含 POST /reviews、diagnose、roles、start、SSE meeting/stream、report、export 边界） |
| Route A | `node scripts/setup-demo-review.js` | ✅ Review created/diagnosed/roles saved/started；Report src `mock_fallback` |
| Route B | `node scripts/setup-demo-review.js --with-runner` | ✅ **首次失败→修复后通过**：agent turns 实跑，Report src `db_opinions`，providerSummary `Mock(3)` |

> Route B 首跑因 §4 第二处写入点未补而失败，修复后通过——证明加性迁移在端到端路径下不破。

### 5.6 密钥扫描
- 命令：`git grep -nE 'sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]{20,}' -- apps/api docs/`
- 结果：**exit 1（无匹配）**——干净。

---

## 6. 红线自检

| 红线 | 状态 |
|---|---|
| 不提交 / 不推送 | ✅ 未执行 `git commit` / `git push`（仅本地改动 + 本证据文档） |
| 仅加性 schema，不动运行时/枚举/状态机 | ✅ `git diff` 确认：`reviews.service.ts` 的 `REVIEW_STATUS_FLOW` **未改动**；`schema.prisma` **无任何 enum 改写**；未触碰 graph/Moderator/round-2 逻辑 |
| 不伪造证据 | ✅ 全部为实跑输出（tsc / migrate / raw SQL 复核 / 3 路冒烟） |
| 不写真实密钥 | ✅ 密钥扫描干净；`.env` 未被改动 |
| 范围不越界 9.3 | ✅ 见 §1 拆分表；`ReviewCheckpoint`/`ModeratorDecision` 表已建但**未写入任何运行时数据** |

---

## 7. 变更文件清单（未提交）

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `apps/api/prisma/schema.prisma` | 修改 | 2 新表 + 3 既有模型加列（详见 §2） |
| `apps/api/src/modules/reviews/queue/queue.service.ts` | 修改 | `reviewTurn.create` 补 `round`/`idempotencyKey` |
| `scripts/run-agent-turns-for-review.js` | 修改 | `reviewTurn.create` 补 `round`/`idempotencyKey`（新发现写入点） |
| `apps/api/prisma/migrations/20260713121800_add_orchestrator_spine_schema/migration.sql` | 新增（被 .gitignore 忽略） | 加性迁移 SQL（见 §3） |

> `git status` 仅显示 3 个业务文件改动；迁移 SQL 因 `.gitignore` 忽略未计入暂存，审阅以本文件 §3 + 本地文件为准。

---

## 8. 给 Codex / workbuddy-review 的建议

1. **建议走标准 Gate 复审**：本 Sprint 触及**业务代码 + DB schema**，符合 §13.2 标准 Gate 触发条件；tsc 0 error、迁移实跑、3 路冒烟全绿、密钥扫描干净，证据齐备。
2. **重点复审项**：
   - `idempotencyKey` 历史回填公式（用行 PK 作第三拼接段，非 Contract 的 `${reviewId}::${roleVersionId}::${round}`）——属 9.2 临时满足约束之举，9.3 需重写为语义正确的幂等键；
   - `scripts/run-agent-turns-for-review.js` 的连带修复（任务原假设遗漏点）；
   - 迁移 `SET NOT NULL` 顺序安全（先可空→回填→再 NOT NULL，零数据丢失）。
3. **9.3 待办**（明确不在本次）：§7.6 枚举迁移、`REVIEW_STATUS_FLOW` 重写、graph runtime、Moderator 运行时、round-2 / checkpoint resume 写入逻辑。
