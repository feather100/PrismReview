-- Review response language override (zh / en / null=auto)
ALTER TABLE "reviews" ADD COLUMN "review_lang" TEXT;
CREATE INDEX IF NOT EXISTS "reviews_review_lang_idx" ON "reviews" ("review_lang");
