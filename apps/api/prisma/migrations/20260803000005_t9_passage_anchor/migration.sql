-- ============================================================
-- T9 (Sprint 11.0): Passage-level anchors
-- ============================================================
-- reviews.passages（原文段落索引）+ review_opinions.passage_refs（意见引用的段落）
-- ============================================================

ALTER TABLE "reviews" ADD COLUMN "passages" JSONB;
ALTER TABLE "review_opinions" ADD COLUMN "passage_refs" JSONB;
