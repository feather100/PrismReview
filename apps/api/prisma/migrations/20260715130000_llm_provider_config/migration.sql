-- LLM Provider configuration (runtime admin-managed)
-- Multiple providers can be stored; exactly one is active at a time.
-- apiKeyEnc is AES-256-GCM encrypted (base64-encoded).

CREATE TABLE "llm_providers" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"         TEXT NOT NULL UNIQUE,
  "provider"     TEXT NOT NULL,            -- openai_compatible | lmstudio | mock
  "model"        TEXT NOT NULL,
  "base_url"     TEXT NOT NULL,
  "api_key_enc"  TEXT,                     -- base64 of AES-256-GCM ciphertext
  "is_active"    BOOLEAN NOT NULL DEFAULT false,
  "status"       TEXT NOT NULL DEFAULT 'unknown',  -- ready | unreachable | unknown
  "last_test_at" TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "llm_providers_is_active_idx" ON "llm_providers" ("is_active");

-- Verweis vom Review auf den genutzten LlmProvider
ALTER TABLE "reviews" ADD COLUMN "llm_provider_id" UUID;
CREATE INDEX "reviews_llm_provider_id_idx" ON "reviews" ("llm_provider_id");
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_llm_provider_id_fk"
  FOREIGN KEY ("llm_provider_id") REFERENCES "llm_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
