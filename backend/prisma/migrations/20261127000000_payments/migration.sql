-- Phase 2 / A11 — payments and their append-only ledger.
--
-- Written by hand: `prisma migrate diff` needs a shadow database and no Docker
-- daemon was available when this migration was added. Column-for-column match
-- with schema.prisma; `prisma validate` and `prisma migrate deploy` are the gates.

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18, 4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "provider" VARCHAR(20) NOT NULL,
    "gateway_reference" VARCHAR(200),
    "idempotency_key" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(18, 4) NOT NULL,
    "gateway_reference" VARCHAR(200),
    "gateway_event_id" VARCHAR(160),
    "idempotency_key" VARCHAR(160),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_tenant_id_idempotency_key_key" ON "payment"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_tenant_id_organisation_id_idx" ON "payment"("tenant_id", "organisation_id");

-- CreateIndex
CREATE INDEX "payment_tenant_id_order_id_idx" ON "payment"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "payment_tenant_id_status_idx" ON "payment"("tenant_id", "status");

-- CreateIndex
-- NULLs are distinct in Postgres, so locally-originated events (which have no
-- gateway id) are unaffected; two rows with the same gateway id are not.
CREATE UNIQUE INDEX "payment_event_gateway_event_id_key" ON "payment_event"("gateway_event_id");

-- CreateIndex
CREATE INDEX "payment_event_tenant_id_payment_id_created_at_idx" ON "payment_event"("tenant_id", "payment_id", "created_at");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "customer_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
