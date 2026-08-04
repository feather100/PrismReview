-- ============================================================
-- T1 (Sprint 11.0): Opinion Lifecycle + content-key dedup
-- ============================================================
-- review_opinions 新增生命周期列：
--   status             candidate|challenged|accepted|rejected|downgraded（DB 默认 accepted 兼容存量；新意见显式置 candidate）
--   resolution_reason  迁移理由（duplicate_of:<id> / validation_failed / fail_closed / moderator:<reason>）
--   dedup_key          内容键 = dimension:normalizedIssue（同题归并判定）
--   merged_reviewer_ids 被归并到 canonical 的 reviewerId 列表（JSONB）
--   canonical_opinion_id 重复意见指向的 canonical opinion id
-- ============================================================

ALTER TABLE "review_opinions" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE "review_opinions" ADD COLUMN "resolution_reason" TEXT;
ALTER TABLE "review_opinions" ADD COLUMN "dedup_key" TEXT;
ALTER TABLE "review_opinions" ADD COLUMN "merged_reviewer_ids" JSONB;
ALTER TABLE "review_opinions" ADD COLUMN "canonical_opinion_id" UUID;

CREATE INDEX "review_opinions_review_id_dedup_key_idx" ON "review_opinions"("review_id", "dedup_key");