-- ============================================================
-- Sprint 10.1: Provider Security Emergency Hardening
-- ============================================================
-- Note: llm_provider_id column + FK + index already exist (from 20260715073806_init_llm_provider_config)
-- This migration only:
--   1. Add tenantId to LlmProvider (with backfill)
--   2. Add FK + composite unique constraint
--   3. Drop provider_config from Review
-- ============================================================

-- Step 1: Add tenant_id to llm_providers
ALTER TABLE "llm_providers" ADD COLUMN "tenant_id" UUID;

-- Step 2: Backfill existing providers with first tenant
UPDATE "llm_providers" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1)
WHERE "tenant_id" IS NULL;

-- Step 3: Add FK constraint
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- Step 4: Add index on tenant_id
CREATE INDEX "llm_providers_tenant_id_idx" ON "llm_providers"("tenant_id");

-- Step 5: Change name unique constraint to composite (tenant_id, name)
ALTER TABLE "llm_providers" DROP CONSTRAINT "llm_providers_name_key";
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_tenant_id_name_key"
  UNIQUE ("tenant_id", "name");

-- Step 6: Drop provider_config (no longer storing plaintext keys)
ALTER TABLE "reviews" DROP COLUMN "provider_config";
