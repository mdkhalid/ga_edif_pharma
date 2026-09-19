-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductVisibility" AS ENUM ('PUBLIC', 'CATALOGUE_ONLY');

-- AlterTable
ALTER TABLE "user_role" ALTER COLUMN "scope_regions" SET DEFAULT ARRAY[]::VARCHAR(64)[];

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "organisation_id" UUID,
    "name" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "schedule" VARCHAR(10) NOT NULL,
    "hsn_code" VARCHAR(16),
    "strength" VARCHAR(50),
    "pack_size" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pack_unit" VARCHAR(20),
    "price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "visibility" "ProductVisibility" NOT NULL DEFAULT 'PUBLIC',
    "salt_aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "composition_key" TEXT,
    "composition_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_stock" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" VARCHAR(100) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "batch_id" VARCHAR(64),
    "expiry_date" TIMESTAMPTZ(6),
    "reserved" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "warehouse_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "cart_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_order" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLACED',
    "payment_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "delivery_address" TEXT,
    "notes" TEXT,
    "scheduled_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" VARCHAR(30),
    "to_status" VARCHAR(30) NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_tenant_id_schedule_idx" ON "product"("tenant_id", "schedule");

-- CreateIndex
CREATE INDEX "product_tenant_id_status_idx" ON "product"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "warehouse_stock_tenant_id_product_id_idx" ON "warehouse_stock"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_stock_tenant_id_product_id_warehouse_id_key" ON "warehouse_stock"("tenant_id", "product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "cart_tenant_id_status_idx" ON "cart"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "cart_item_cart_id_idx" ON "cart_item"("cart_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_item_cart_id_product_id_key" ON "cart_item"("cart_id", "product_id");

-- CreateIndex
CREATE INDEX "customer_order_tenant_id_status_idx" ON "customer_order"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "customer_order_tenant_id_created_at_idx" ON "customer_order"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "order_item_order_id_idx" ON "order_item"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_order_id_product_id_key" ON "order_item"("order_id", "product_id");

-- CreateIndex
CREATE INDEX "order_status_history_tenant_id_order_id_created_at_idx" ON "order_status_history"("tenant_id", "order_id", "created_at");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
