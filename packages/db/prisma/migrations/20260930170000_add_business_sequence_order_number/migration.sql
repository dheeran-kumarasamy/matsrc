-- EQ/OD/IN Business Numbering — backfilled migration.
--
-- This migration file was missing from the repo even though the
-- corresponding schema.prisma changes (Order.orderNumber + BusinessSequence
-- model) were committed in 019ed9b ("feat(business-numbering): implement
-- EQ/OD/IN business number format"). That change was applied directly to
-- at least one database via `prisma db push` rather than a committed
-- migration (confirmed: that database's _prisma_migrations table has no
-- record of this change even though the column/table physically exist
-- there), leaving `prisma migrate deploy` unable to bring any OTHER
-- database (e.g. a freshly-provisioned UAT database) up to the same
-- schema.
--
-- Written defensively with IF NOT EXISTS / DO blocks so it is a safe no-op
-- on a database where the column/table/index already exist (e.g. the one
-- above that received it via db push), and performs the real DDL on any
-- database that never received it (e.g. UAT).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Order' AND column_name = 'orderNumber'
  ) THEN
    ALTER TABLE "Order" ADD COLUMN "orderNumber" TEXT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_orderNumber_key" ON "Order"("orderNumber");

CREATE TABLE IF NOT EXISTS "BusinessSequence" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessSequence_type_fy_key" ON "BusinessSequence"("type", "fy");
