-- AlterTable
ALTER TABLE "moderator_decisions" ADD COLUMN     "llm_raw_output" TEXT,
ADD COLUMN     "proposed_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sanity_check_result" JSONB,
ADD COLUMN     "tool_approval_reasoning" TEXT;

-- AlterTable
ALTER TABLE "review_opinions" ADD COLUMN     "source" TEXT DEFAULT 'llm';

-- CreateTable
CREATE TABLE "tool_call_requests" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "requested_by" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "approved_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "denied_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "tool_call_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_definitions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "input_schema" JSONB NOT NULL,
    "mcp_server_ref" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tool_call_requests_review_id_round_idx" ON "tool_call_requests"("review_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "tool_definitions_name_key" ON "tool_definitions"("name");

-- AddForeignKey
ALTER TABLE "tool_call_requests" ADD CONSTRAINT "tool_call_requests_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
