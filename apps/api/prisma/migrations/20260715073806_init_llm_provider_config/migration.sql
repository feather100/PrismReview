-- DropIndex
DROP INDEX "reviews_llm_provider_id_idx";

-- DropIndex
DROP INDEX "reviews_provider_override_idx";

-- AlterTable
ALTER TABLE "llm_providers" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "last_test_at" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- RenameForeignKey
ALTER TABLE "reviews" RENAME CONSTRAINT "reviews_llm_provider_id_fk" TO "reviews_llm_provider_id_fkey";
