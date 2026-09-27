-- CreateEnum
CREATE TYPE "SchemeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SchemeKind" AS ENUM ('PERCENTAGE', 'FLAT', 'FREE_GOODS', 'COMBO');

-- CreateTable
CREATE TABLE "scheme" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "SchemeStatus" NOT NULL DEFAULT 'ACTIVE',
    "kind" "SchemeKind" NOT NULL,
    "product_id" UUID,
    "category_id" UUID,
    "percent_off" DECIMAL(5,2),
    "flat_off" DECIMAL(18,4),
    "min_qty" INTEGER,
    "buy_qty" INTEGER,
    "free_qty" INTEGER,
    "combo_product_ids" TEXT[],
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_to" TIMESTAMPTZ(6) NOT NULL,
    "stackable" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "scheme_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "scheme" ADD CONSTRAINT "scheme_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "scheme_tenant_id_status_kind_idx" ON "scheme"("tenant_id", "status", "kind");
