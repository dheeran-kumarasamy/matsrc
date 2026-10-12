-- Advance Payment Receipt — additive-only migration.
--
-- Introduces a new AdvanceReceipt table, generated exactly once, atomically,
-- at the moment a Buildohub Advance Payment is genuinely SETTLED (the
-- CREDIT CustomerAdvanceTransaction row is written — see
-- AdvancePaymentsService.approve / createAdvanceReceipt in
-- packages/db/lib/advance-ledger.ts). This migration does NOT alter, drop,
-- or backfill any existing column, table, row, or constraint — every new
-- relation is purely additive (new FK columns live on the new table only).

-- CreateTable
CREATE TABLE "AdvanceReceipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionId" TEXT NOT NULL,
    "advanceAccountId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "advancePaymentId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentMethod" "AdvancePaymentMethod",
    "paymentReferenceNo" TEXT,
    "buyerName" TEXT,
    "buyerEmail" TEXT,
    "buyerPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvanceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceReceipt_receiptNumber_key" ON "AdvanceReceipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceReceipt_transactionId_key" ON "AdvanceReceipt"("transactionId");

-- CreateIndex
CREATE INDEX "AdvanceReceipt_buyerId_idx" ON "AdvanceReceipt"("buyerId");

-- CreateIndex
CREATE INDEX "AdvanceReceipt_advanceAccountId_idx" ON "AdvanceReceipt"("advanceAccountId");

-- CreateIndex
CREATE INDEX "AdvanceReceipt_advancePaymentId_idx" ON "AdvanceReceipt"("advancePaymentId");

-- AddForeignKey
ALTER TABLE "AdvanceReceipt" ADD CONSTRAINT "AdvanceReceipt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CustomerAdvanceTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceReceipt" ADD CONSTRAINT "AdvanceReceipt_advanceAccountId_fkey" FOREIGN KEY ("advanceAccountId") REFERENCES "CustomerAdvanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceReceipt" ADD CONSTRAINT "AdvanceReceipt_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceReceipt" ADD CONSTRAINT "AdvanceReceipt_advancePaymentId_fkey" FOREIGN KEY ("advancePaymentId") REFERENCES "AdvancePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
