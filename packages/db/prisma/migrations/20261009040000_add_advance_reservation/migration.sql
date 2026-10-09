-- Buildohub Advance Balance — Reservation lifecycle fix.
-- Additive-only migration: introduces AdvanceReservation, the
-- AdvanceReservationStatus enum, two new AdvanceTransactionType enum
-- values (ADVANCE_RESERVATION / ADVANCE_RELEASE), and a new
-- CustomerAdvanceAccount.reservedBalance column (default 0, so every
-- existing account row is automatically treated as having nothing
-- reserved). No existing table/column/enum value is altered or dropped;
-- no existing CustomerAdvanceTransaction/AdvancePayment row is rewritten.
--
-- Postgres requires new enum values to be added outside a transaction
-- block (each ALTER TYPE ... ADD VALUE on its own statement).

-- AlterEnum
ALTER TYPE "AdvanceTransactionType" ADD VALUE 'ADVANCE_RESERVATION';

-- AlterEnum
ALTER TYPE "AdvanceTransactionType" ADD VALUE 'ADVANCE_RELEASE';

-- CreateEnum
CREATE TYPE "AdvanceReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- AlterTable
ALTER TABLE "CustomerAdvanceAccount" ADD COLUMN "reservedBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AdvanceReservation" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "advanceAccountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "AdvanceReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvanceReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceReservation_orderId_key" ON "AdvanceReservation"("orderId");

-- CreateIndex
CREATE INDEX "AdvanceReservation_buyerId_idx" ON "AdvanceReservation"("buyerId");

-- CreateIndex
CREATE INDEX "AdvanceReservation_advanceAccountId_idx" ON "AdvanceReservation"("advanceAccountId");

-- CreateIndex
CREATE INDEX "AdvanceReservation_orderId_idx" ON "AdvanceReservation"("orderId");

-- CreateIndex
CREATE INDEX "AdvanceReservation_status_idx" ON "AdvanceReservation"("status");

-- AddForeignKey
ALTER TABLE "AdvanceReservation" ADD CONSTRAINT "AdvanceReservation_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceReservation" ADD CONSTRAINT "AdvanceReservation_advanceAccountId_fkey" FOREIGN KEY ("advanceAccountId") REFERENCES "CustomerAdvanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceReservation" ADD CONSTRAINT "AdvanceReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
