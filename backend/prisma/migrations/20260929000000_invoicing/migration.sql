-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED', 'CREDITED');

-- AlterTable
ALTER TABLE "product" ADD COLUMN "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "order_id" UUID,
    "invoice_number" VARCHAR(64) NOT NULL,
    "invoice_date" TIMESTAMPTZ(6) NOT NULL,
    "fiscal_year" VARCHAR(9) NOT NULL,
    "gst_type" VARCHAR(10) NOT NULL,
    "supplier_state_code" VARCHAR(2) NOT NULL,
    "customer_state_code" VARCHAR(2) NOT NULL,
    "taxable_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "igst" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "notes" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "hsn_code" VARCHAR(16) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxable_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "igst" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" VARCHAR(300),

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "fiscal_year" VARCHAR(9) NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_sequence_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "customer_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequence" ADD CONSTRAINT "invoice_sequence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddUniqueConstraint (gapless numbering: one number, one invoice, per tenant)
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_invoice_number_key" UNIQUE ("tenant_id", "invoice_number");

-- AddUniqueConstraint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_product_id_key" UNIQUE ("invoice_id", "product_id");

-- AddUniqueConstraint (one counter row per tenant and fiscal year)
ALTER TABLE "invoice_sequence" ADD CONSTRAINT "invoice_sequence_tenant_id_fiscal_year_key" UNIQUE ("tenant_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "invoice_tenant_id_status_idx" ON "invoice"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "invoice_tenant_id_organisation_id_idx" ON "invoice"("tenant_id", "organisation_id");

-- CreateIndex
CREATE INDEX "invoice_tenant_id_order_id_idx" ON "invoice"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "invoice_line_tenant_id_invoice_id_idx" ON "invoice_line"("tenant_id", "invoice_id");
