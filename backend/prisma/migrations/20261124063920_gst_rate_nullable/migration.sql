-- AlterTable
ALTER TABLE "product" ALTER COLUMN "gst_rate" DROP NOT NULL,
ALTER COLUMN "gst_rate" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_role" ALTER COLUMN "scope_regions" SET DEFAULT ARRAY[]::VARCHAR(64)[];
