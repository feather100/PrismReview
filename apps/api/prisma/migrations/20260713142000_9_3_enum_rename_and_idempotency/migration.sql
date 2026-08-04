-- Sprint 9.3 — P1 enum rename + idempotencyKey backfill correction
-- Scope (per Contract §7.6 / Codex 指令 1 & 4):
--   1) Review.status default renamed draft -> created (text column, NOT a native PG enum)
--   2) Data migration: existing Review rows remapped per §7.6
--   3) Carryover fix: ReviewTurn.idempotency_key rewritten from 9.2 PK-style
--      (review::role::<uuid>) to semantic key review::role::round (round=1 for
--      historical rows), with a per-group disambiguator for demo duplicate turns
--      so the UNIQUE(idempotency_key) constraint stays valid.
--
-- SAFETY:
--   * Review.status is a Prisma `String` (text) column. There is NO native
--     Postgres enum type, so no DROP VALUE / data-loss risk. The only schema
--     delta is the column default change below.
--   * All UPDATEs are idempotent: re-running the migration reproduces the same
--     result (no rows satisfy the old-value WHERE; idempotency keys are
--     recomputed from review_id/role_version_id/round).
--   * No rows are deleted; duplicate demo turns are disambiguated, not dropped.

-- 1) Schema delta (from `prisma migrate diff --from-url --to-schema-datamodel`)
ALTER TABLE "reviews" ALTER COLUMN "status" SET DEFAULT 'created';

-- 2) Review.status data remap (§7.6). Only old values are touched.
UPDATE "reviews"
SET "status" = CASE "status"
  WHEN 'draft'       THEN 'created'
  WHEN 'diagnosing' THEN 'created'
  WHEN 'ready'       THEN 'diagnosed'
  WHEN 'summarizing' THEN 'summarized'
  ELSE "status"
END
WHERE "status" IN ('draft', 'diagnosing', 'ready', 'summarizing');

-- 3) ReviewTurn.idempotency_key: rewrite 9.2 PK-style keys to semantic keys.
--    Duplicate (review_id, role_version_id, round) groups (demo re-runs) get a
--    deterministic `::<n>` disambiguator (n = 0-based ordinal) to keep UNIQUE.
UPDATE "review_turns" t
SET "idempotency_key" = base.rev || '::' || base.rv || '::' || base.rnd
                         || CASE WHEN base.cnt > 1 THEN '::' || (base.rn - 1) ELSE '' END
FROM (
  SELECT
    "id",
    "review_id"::text                              AS rev,
    "role_version_id"::text                        AS rv,
    COALESCE("round", 1)::text                     AS rnd,
    row_number() OVER (
      PARTITION BY "review_id", "role_version_id", COALESCE("round", 1)
      ORDER BY "id"
    )                                              AS rn,
    count(*) OVER (
      PARTITION BY "review_id", "role_version_id", COALESCE("round", 1)
    )                                              AS cnt
  FROM "review_turns"
) base
WHERE t."id" = base."id"
  AND t."idempotency_key" IS NOT NULL;
