-- AlterTable
ALTER TABLE "customer_order" ADD COLUMN     "prescription_id" UUID;

-- AlterTable
ALTER TABLE "user_role" ALTER COLUMN "scope_regions" SET DEFAULT ARRAY[]::VARCHAR(64)[];

-- CreateTable
CREATE TABLE "prescription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "patient_ref" VARCHAR(200),
    "doctor_name" VARCHAR(200),
    "reference_number" VARCHAR(100),
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "attachment_key" VARCHAR(500),
    "attachment_mime_type" VARCHAR(100),
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "rejection_reason" VARCHAR(500),
    "dispensing_count" INTEGER NOT NULL DEFAULT 0,
    "max_dispensings" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prescription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prescription_tenant_id_organisation_id_idx" ON "prescription"("tenant_id", "organisation_id");

-- CreateIndex
CREATE INDEX "prescription_tenant_id_status_idx" ON "prescription"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription" ADD CONSTRAINT "prescription_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription" ADD CONSTRAINT "prescription_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "customer_price_override_tenant_id_organisation_id_product_id_ke" RENAME TO "customer_price_override_tenant_id_organisation_id_product_i_key";
