# 部署迁移执行清单（Database Migration Deployment Checklist）

> **版本：** v1.0（2026-08-03）
> **背景：** 本仓库 `apps/api/prisma/migrations/` 目录按仓库惯例被 `.gitignore` 忽略（历史约定），**迁移 SQL 只存在于本地**；任何新环境（CI/部署/他人 clone）都不会自动获得迁移文件。本清单解决"谁部署谁踩坑"的问题。
> **状态：** ✅ 已在本地开发库实跑通过（见 §6）

---

## 1. 环境要求

| 项 | 要求 |
|----|------|
| PostgreSQL | ≥ 14（本地用 postgres:16-alpine via docker-compose） |
| 连接串 | `apps/api/.env` → `DATABASE_URL="postgresql://prismreview:***@localhost:5432/prismreview?schema=public"` |
| Prisma | `apps/api` 下 `npx prisma`（5.22.0） |
| Docker（可选） | `docker compose up -d postgres` 一键起库 |

## 2. 迁移总表（15 个）

| # | 迁移 | 说明 | 破坏性 |
|---|------|------|--------|
| 1 | 20260707014831_init | 初始建表 | 新建 |
| 2 | 20260713121800_add_orchestrator_spine_schema | 编排脊柱表（Review/ReviewTurn/Checkpoint…） | 加表 |
| 3 | 20260713142000_9_3_enum_rename_and_idempotency | 枚举改名 + idempotencyKey 回填 | 改列 |
| 4 | 20260714072154_add_quality_report | QualityReport 表 | 加表 |
| 5 | 20260714103558_add_p3_memory_prompt | Memory/Prompt 表 | 加表 |
| 6 | 20260714114906_add_p4_tool_hitl | Tool/HITL 表 + ReviewOpinion.source | 加表/列 |
| 7 | 20260714124941_add_p5_workflow_scoring | 评分快照列（Review.scoring_config 等） | 加列 |
| 8 | 20260715073806_init_llm_provider_config | llm_providers 初建 | 加表 |
| 9 | 20260715110000_productization_provider_override | per-review provider override（provider_config） | 加列 |
| 10 | 20260715130000_llm_provider_config | provider 运行时管理（加密 key） | 改表 |
| 11 | 20260715140000_review_lang | Review.lang（zh/en 响应语言） | 加列 |
| 12 | 20260715150000_defense_mention_loop | @Expert mention + 用户申辩循环 | 加列 |
| 13 | 20260729000000_sprint_10_1_provider_security | 安全加固：llm_providers.tenant_id + FK + 复合唯一；**删除 reviews.provider_config**（含回滚 SQL） | ⚠️ 删列 |
| 14 | 20260803000000_t1_opinion_lifecycle | T1：ReviewOpinion 加 status/resolution_reason/dedup_key/merged_reviewer_ids/canonical_opinion_id + 索引 | 加列 |
| 15 | 20260803000001_t2_convergence_stance | T2：ReviewOpinion.stance | 加列 |

**注意：** 迁移 13（Sprint 10.1）删除了 `reviews.provider_config`，执行前必须备份；回滚脚本见 `migrations/20260729000000_sprint_10_1_provider_security/rollback.sql`。

## 3. 执行步骤

### 3.1 开发库（本地）

```bash
# 1) 起库（docker-compose）
docker compose up -d postgres

# 2) 生成 client（schema 变更后）
cd apps/api && npx prisma generate

# 3) 查看待应用迁移
npx prisma migrate status

# 4) 应用（开发用 migrate dev；纯应用用 migrate deploy）
npx prisma migrate deploy        # 生产风格：只应用待迁移，不重置
# 或 npx prisma migrate dev      # 开发：可能提示重置/生成迁移
```

### 3.2 生产/CI

1. **迁移文件随发布物携带**：migrations 目录被 gitignore，发布流程必须显式带上（构建产物归档或取消忽略——**建议改为入库**，见 §5 风险项）；
2. 备份：`pg_dump -Fc prismreview > backup.dump`；
3. `npx prisma migrate deploy`（CI 部署作业中执行）；
4. 验证（见 §4）。

## 4. 验证清单（部署后逐项勾选）

- [ ] `npx prisma migrate status` → `Database schema is up to date!`
- [ ] `review_opinions` 含列：`status / resolution_reason / dedup_key / merged_reviewer_ids / canonical_opinion_id / stance`（T1/T2）
- [ ] `llm_providers` 含列：`tenant_id`（Sprint 10.1）
- [ ] `reviews` **不含** `provider_config`（Sprint 10.1 已删）
- [ ] 数据行数合理（迁移前记录，迁移后对比）：本次实跑 514 opinions / 460 reviews / 1 provider 完好
- [ ] `npx tsc --noEmit` 0 error；`npx jest` 全绿（150 例）
- [ ] 应用启动后 `GET /api/reviews` 与 `GET /api/audit` 正常

## 5. 已知风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| ~~迁移文件不入库~~ | ~~新环境无迁移文件~~ | ✅ 已解决（2026-08-04）：迁移文件已入库（.gitignore 移除），CI 用 `migrate deploy` |
| 迁移 13 删列 | provider_config 数据丢失 | 执行前 pg_dump；回滚脚本已提供 |
| 分支/环境 schema 漂移 | migrate deploy 报 pending 与预期不符 | 以 §4 验证清单为准；异常时对比迁移表 `_prisma_migrations` |
| 已有数据 + 新列 | 加 NOT NULL 列默认值 | T1/T2 均带 DEFAULT，存量行安全（已实跑验证） |

## 6. 本次实跑记录（2026-08-03）

- 环境：docker-compose Postgres 16（healthy）
- 初始状态：13/15 已应用，pending = T1（20260803000000）、T2（20260803000001）
- `prisma migrate deploy` → 两迁移成功应用
- 验证：schema up to date；review_opinions 全部 T1/T2 列存在；llm_providers.tenant_id 存在；数据 514/460/1 完好
- 结论：✅ 本地开发库迁移闭环；生产部署按 §3.2 + §4 执行

---

> **下一步建议：** ① 讨论是否取消 migrations 目录的 gitignore（建议入库）；② CI 增加 `prisma migrate deploy` + `migrate status` 检查作业。