-- DropIndex
DROP INDEX "product_name_trgm_idx";

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "mfa_recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfa_secret" VARCHAR(512);

-- AlterTable
ALTER TABLE "user_role" ALTER COLUMN "scope_regions" SET DEFAULT ARRAY[]::VARCHAR(64)[];
