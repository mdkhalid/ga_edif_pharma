-- AlterTable
ALTER TABLE "user_role" ALTER COLUMN "scope_regions" SET DEFAULT ARRAY[]::VARCHAR(64)[];

-- CreateTable
CREATE TABLE "push_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "provider" VARCHAR(16) NOT NULL DEFAULT 'console',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "push_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "push_token_tenant_id_user_id_idx" ON "push_token"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_token_user_id_token_key" ON "push_token"("user_id", "token");

-- AddForeignKey
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
