-- ============================================================
-- T2 (Sprint 11.0): Convergence stance signal
-- ============================================================
-- review_opinions 新增 stance（agree|disagree|neutral，默认 neutral），
-- 驱动"全员 AGREE"收敛判定（Moderator 终止条件三选一之一）。
-- ============================================================

ALTER TABLE "review_opinions" ADD COLUMN "stance" TEXT NOT NULL DEFAULT 'neutral';
