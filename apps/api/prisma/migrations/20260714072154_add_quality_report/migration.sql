-- CreateTable
CREATE TABLE "quality_reports" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "provider_source" TEXT NOT NULL,
    "run_mode" TEXT NOT NULL,
    "avg_confidence" DOUBLE PRECISION NOT NULL,
    "min_confidence" INTEGER NOT NULL,
    "max_confidence" INTEGER NOT NULL,
    "opinion_count" INTEGER NOT NULL,
    "dimensions_covered" TEXT[],
    "risk_distribution" JSONB NOT NULL,
    "consistency_score" DOUBLE PRECISION,
    "missing_dimensions" TEXT[],
    "duration_ms" INTEGER NOT NULL,
    "model_name" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_reports_provider_source_run_mode_idx" ON "quality_reports"("provider_source", "run_mode");

-- AddForeignKey
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
