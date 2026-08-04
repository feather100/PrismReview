-- ============================================================
-- T4 (Sprint 11.0): Scoring pass — observation/judgment separation
-- ============================================================
-- review_opinions 新增 score（Moderator 评分 pass 基于观察聚合的维度质量分 0-100，
-- 可空；null 回退 reviewer confidenceScore）。评审员不再直接决定最终分数。
-- ============================================================

ALTER TABLE "review_opinions" ADD COLUMN "score" INTEGER;
