-- AlterTable
ALTER TABLE "review_opinions" ADD COLUMN     "round" INTEGER,
ADD COLUMN     "schema_version" TEXT NOT NULL DEFAULT '1.0';

-- AlterTable
ALTER TABLE "review_turns" ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "schema_version" TEXT NOT NULL DEFAULT '1.0';

-- Backfill existing rows (324) with a unique, non-null idempotency_key.
-- Historical demo data contains duplicate (review_id, role_version_id) pairs
-- (re-runs of setup-demo-review), so we disambiguate with the row PK to
-- guarantee uniqueness. All historical turns are round-1; the idempotency
-- check itself is implemented in 9.3 (runtime), so this value only needs to
-- satisfy the NOT NULL + UNIQUE constraint for 9.2.
UPDATE "review_turns" SET "idempotency_key" = "review_id"::text || '::' || "role_version_id"::text || '::' || "id"::text WHERE "idempotency_key" IS NULL;

-- Enforce NOT NULL now that every row is populated (no data loss).
ALTER TABLE "review_turns" ALTER COLUMN "idempotency_key" SET NOT NULL;

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "current_node_id" TEXT,
ADD COLUMN     "current_round" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "review_checkpoints" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "state_json" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderator_decisions" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "decision_type" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "rule_check_result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderator_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_checkpoints_review_id_idx" ON "review_checkpoints"("review_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_checkpoints_review_id_sequence_key" ON "review_checkpoints"("review_id", "sequence");

-- CreateIndex
CREATE INDEX "moderator_decisions_review_id_round_idx" ON "moderator_decisions"("review_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "review_turns_idempotency_key_key" ON "review_turns"("idempotency_key");

-- AddForeignKey
ALTER TABLE "review_checkpoints" ADD CONSTRAINT "review_checkpoints_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderator_decisions" ADD CONSTRAINT "moderator_decisions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

