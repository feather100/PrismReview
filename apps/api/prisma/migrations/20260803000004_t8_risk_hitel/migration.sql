-- ============================================================
-- T8 (Sprint 11.0): Risk-graded HITL
-- ============================================================
-- reviews 新增 human_gate_approved（高风险低置信度意见的人工门放行标志）
-- ============================================================

ALTER TABLE "reviews" ADD COLUMN "human_gate_approved" BOOLEAN NOT NULL DEFAULT false;
