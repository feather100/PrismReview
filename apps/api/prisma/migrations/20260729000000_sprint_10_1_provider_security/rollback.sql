-- ============================================================
-- Sprint 10.1 Rollback（P1-3 要求）
-- ============================================================
-- 回滚 20260729000000_sprint_10_1_provider_security 的增量：
--   1. 删除 tenant_id 复合唯一约束 / FK / 索引 / 列
--   2. 恢复 name 唯一约束
--   3. 恢复 reviews.provider_config 列（注意：正向迁移 DROP 前未备份的数据无法恢复，
--      执行回滚前必须对 llm_providers / reviews 做 pg_dump 备份 —— P1-3 要求）
-- ============================================================

-- Step 1: drop composite unique (tenant_id, name)
ALTER TABLE "llm_providers" DROP CONSTRAINT IF EXISTS "llm_providers_tenant_id_name_key";

-- Step 2: drop FK to tenants
ALTER TABLE "llm_providers" DROP CONSTRAINT IF EXISTS "llm_providers_tenant_id_fkey";

-- Step 3: drop index
DROP INDEX IF EXISTS "llm_providers_tenant_id_idx";

-- Step 4: drop tenant_id column
ALTER TABLE "llm_providers" DROP COLUMN IF EXISTS "tenant_id";

-- Step 5: restore name unique constraint
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_name_key" UNIQUE ("name");

-- Step 6: restore provider_config on reviews (data loss warning: only schema, no backfill)
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "provider_config" JSONB;
