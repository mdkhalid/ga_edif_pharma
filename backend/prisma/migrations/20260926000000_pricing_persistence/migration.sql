-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "price_list" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "PriceListStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_line" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "min_qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "price_list_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_price_list" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,

    CONSTRAINT "customer_price_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_price_override" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "customer_price_override_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_line" ADD CONSTRAINT "price_list_line_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_price_list" ADD CONSTRAINT "customer_price_list_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "price_list_tenant_id_status_idx" ON "price_list"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_line_price_list_id_product_id_min_qty_key" ON "price_list_line"("price_list_id", "product_id", "min_qty");

-- CreateIndex
CREATE INDEX "price_list_line_tenant_id_product_id_idx" ON "price_list_line"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_price_list_tenant_id_organisation_id_key" ON "customer_price_list"("tenant_id", "organisation_id");

-- CreateIndex
CREATE INDEX "customer_price_list_tenant_id_price_list_id_idx" ON "customer_price_list"("tenant_id", "price_list_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_price_override_tenant_id_organisation_id_product_id_key" ON "customer_price_override"("tenant_id", "organisation_id", "product_id");

-- CreateIndex
CREATE INDEX "customer_price_override_tenant_id_organisation_id_idx" ON "customer_price_override"("tenant_id", "organisation_id");
