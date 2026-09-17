-- ════════════════════════════════════════════════════════════════════════════
-- MediChain — Phase 1: Core Commerce MVP
-- New tables: Product, WarehouseStock, Cart, CartItem, CustomerOrder, OrderItem
-- ════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductVisibility" AS ENUM ('PUBLIC', 'CATALOGUE_ONLY');

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL @map("tenant_id"),
    "organisationId" UUID @map("organisation_id"),
    "name" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "schedule" VARCHAR(10) NOT NULL,
    "hsnCode" VARCHAR(16),
    "strength" VARCHAR(50),
    "packSize" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("pack_size"),
    "packUnit" VARCHAR(20),
    "price" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("price"),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "visibility" "ProductVisibility" NOT NULL DEFAULT 'PUBLIC',

    -- Aliases / salt variations that this product maps to.
    "saltAliases" TEXT[] NOT NULL DEFAULT '{}' @map("salt_aliases"),
    "compositionKey" TEXT @map("composition_key"),
    "compositionNames" TEXT[] NOT NULL DEFAULT '{}' @map("composition_names"),

    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP @map("created_at"),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL @updatedAt @map("updated_at"),

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_tenantId_schedule_idx" ON "product" ("tenantId", "schedule");

-- CreateIndex
CREATE INDEX "product_tenantId_status_idx" ON "product" ("tenantId", "status");

-- CreateTable
CREATE TABLE "warehouse_stock" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL @map("tenant_id"),
    "productId" UUID NOT NULL @map("product_id"),
    "warehouseId" VARCHAR(100) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("quantity"),
    "batchId" VARCHAR(64),
    "expiryDate" TIMESTAMPTZ(6),

    "reserved" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("reserved"),

    CONSTRAINT "warehouse_stock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_stock_tenantId_productId_warehouseId_key" ON "warehouse_stock" ("tenantId", "productId", "warehouseId");

-- CreateIndex
CREATE INDEX "warehouse_stock_tenantId_productId_idx" ON "warehouse_stock" ("tenantId", "productId");

-- CreateTable
CREATE TABLE "cart" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL @map("tenant_id"),
    "organisationId" UUID @map("organisation_id"),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' @map("status"),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL @map("expires_at"),

    CONSTRAINT "cart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cart_tenantId_status_idx" ON "cart" ("tenantId", "status");

-- CreateTable
CREATE TABLE "cart_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL @map("tenant_id"),
    "cartId" UUID NOT NULL @map("cart_id"),
    "productId" UUID NOT NULL @map("product_id"),
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("quantity"),
    "price" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("price"),

    CONSTRAINT "cart_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cart_item_cartId_productId_key" ON "cart_item" ("cartId", "productId");

-- CreateIndex
CREATE INDEX "cart_item_cartId_idx" ON "cart_item" ("cartId");

-- CreateTable
CREATE TABLE "customer_order" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL @map("tenant_id"),
    "organisationId" UUID @map("organisation_id"),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLACED' @map("status"),
    "paymentStatus" VARCHAR(20) NOT NULL DEFAULT 'PENDING' @map("payment_status"),
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("subtotal"),
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("discount"),
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("total"),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR' @map("currency"),
    "deliveryAddress" TEXT,
    "notes" TEXT,
    "scheduledAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledReason" VARCHAR(200),

    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP @map("created_at"),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL @updatedAt @map("updated_at"),

    CONSTRAINT "customer_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_order_tenantId_status_idx" ON "customer_order" ("tenantId", "status");

-- CreateIndex
CREATE INDEX "customer_order_tenantId_createdAt_idx" ON "customer_order" ("tenantId", "createdAt");

-- CreateTable
CREATE TABLE "order_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL @map("tenant_id"),
    "orderId" UUID NOT NULL @map("order_id"),
    "productId" UUID NOT NULL @map("product_id"),
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("quantity"),
    "price" DECIMAL(18,4) NOT NULL DEFAULT 0 @map("price"),

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_item_orderId_productId_key" ON "order_item" ("orderId", "productId");

-- CreateIndex
CREATE INDEX "order_item_orderId_idx" ON "order_item" ("orderId");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;