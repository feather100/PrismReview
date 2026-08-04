-- Productization: per-review LLM provider override
-- Allows each review to optionally use a different model provider / model / baseUrl / apiKey
-- than the global process-env default. Falls back to env when provider_override IS NULL.
-- apiKey is written to provider_config JSON but ALWAYS filtered out of any API response.

ALTER TABLE "reviews"
  ADD COLUMN "provider_override" TEXT,
  ADD COLUMN "provider_config" JSONB;

CREATE INDEX IF NOT EXISTS "reviews_provider_override_idx" ON "reviews" ("provider_override");
