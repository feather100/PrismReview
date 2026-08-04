-- ============================================================
-- T7 (Sprint 11.0): Escalable debate — panel expansion count
-- ============================================================
-- reviews 新增 escalation_count（可升级辩论：未收敛 → 扩容面板 → 仍未收敛 → 人工）
-- ============================================================

ALTER TABLE "reviews" ADD COLUMN "escalation_count" INTEGER NOT NULL DEFAULT 0;
