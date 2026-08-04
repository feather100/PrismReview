-- AlterTable
ALTER TABLE "review_opinions" ADD COLUMN     "prompt_refs" JSONB;

-- CreateTable
CREATE TABLE "reviewer_memories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role_code" TEXT NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "profile" JSONB NOT NULL,
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "last_review_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviewer_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_memories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" TEXT NOT NULL,
    "background" TEXT NOT NULL DEFAULT '',
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" UUID NOT NULL,
    "role_code" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviewer_memories_tenant_id_idx" ON "reviewer_memories"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviewer_memories_tenant_id_role_code_reviewer_user_id_key" ON "reviewer_memories"("tenant_id", "role_code", "reviewer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_memories_tenant_id_project_id_key" ON "project_memories"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "prompt_templates_role_code_layer_idx" ON "prompt_templates"("role_code", "layer");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_role_code_layer_version_key" ON "prompt_templates"("role_code", "layer", "version");
