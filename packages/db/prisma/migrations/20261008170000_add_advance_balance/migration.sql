-- Buildohub Advance Balance (Buyer Advance Payment & Advance Balance)
-- Additive-only migration: introduces CustomerAdvanceAccount, AdvancePayment,
-- CustomerAdvanceTransaction and their enums. No existing table/column is
-- altered or dropped -- existing Order/PaymentVerification/User rows are
-- completely unaffected. At most one CustomerAdvanceAccount is ever created
-- per buyer, and only lazily (on first "Add Advance" submission), so this
-- migration does not backfill/touch any existing User row.

-- CreateEnum
CREATE TYPE "AdvanceAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AdvancePaymentMethod" AS ENUM ('MANUAL', 'PAYMENT_GATEWAY');

-- CreateEnum
CREATE TYPE "AdvancePaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdvanceTransactionType" AS ENUM ('CREDIT', 'ORDER_PAYMENT', 'REFUND', 'REVERSAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "CustomerAdvanceAccount" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "availableBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "AdvanceAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAdvanceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvancePayment" (
    "id" TEXT NOT NULL,
    "advanceAccountId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "AdvancePaymentMethod" NOT NULL DEFAULT 'MANUAL',
    "status" "AdvancePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "screenshotData" BYTEA,
    "screenshotMimeType" TEXT,
    "screenshotFileName" TEXT,
    "screenshotSize" INTEGER,
    "gateway" TEXT,
    "gatewayTransactionId" TEXT,
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "gatewayStatus" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvancePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAdvanceTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "AdvanceTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "status" "AdvancePaymentStatus" NOT NULL DEFAULT 'APPROVED',
    "paymentMethod" "AdvancePaymentMethod",
    "advancePaymentId" TEXT,
    "orderId" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reversalOfTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAdvanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAdvanceAccount_buyerId_key" ON "CustomerAdvanceAccount"("buyerId");

-- CreateIndex
CREATE INDEX "CustomerAdvanceAccount_buyerId_idx" ON "CustomerAdvanceAccount"("buyerId");

-- CreateIndex
CREATE INDEX "CustomerAdvanceAccount_status_idx" ON "CustomerAdvanceAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AdvancePayment_referenceNumber_key" ON "AdvancePayment"("referenceNumber");

-- CreateIndex
CREATE INDEX "AdvancePayment_advanceAccountId_idx" ON "AdvancePayment"("advanceAccountId");

-- CreateIndex
CREATE INDEX "AdvancePayment_buyerId_idx" ON "AdvancePayment"("buyerId");

-- CreateIndex
CREATE INDEX "AdvancePayment_status_idx" ON "AdvancePayment"("status");

-- CreateIndex
CREATE INDEX "AdvancePayment_referenceNumber_idx" ON "AdvancePayment"("referenceNumber");

-- CreateIndex
CREATE INDEX "AdvancePayment_submittedAt_idx" ON "AdvancePayment"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAdvanceTransaction_advancePaymentId_key" ON "CustomerAdvanceTransaction"("advancePaymentId");

-- CreateIndex
CREATE INDEX "CustomerAdvanceTransaction_accountId_idx" ON "CustomerAdvanceTransaction"("accountId");

-- CreateIndex
CREATE INDEX "CustomerAdvanceTransaction_type_idx" ON "CustomerAdvanceTransaction"("type");

-- CreateIndex
CREATE INDEX "CustomerAdvanceTransaction_orderId_idx" ON "CustomerAdvanceTransaction"("orderId");

-- CreateIndex
CREATE INDEX "CustomerAdvanceTransaction_createdAt_idx" ON "CustomerAdvanceTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "CustomerAdvanceAccount" ADD CONSTRAINT "CustomerAdvanceAccount_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePayment" ADD CONSTRAINT "AdvancePayment_advanceAccountId_fkey" FOREIGN KEY ("advanceAccountId") REFERENCES "CustomerAdvanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePayment" ADD CONSTRAINT "AdvancePayment_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAdvanceTransaction" ADD CONSTRAINT "CustomerAdvanceTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAdvanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAdvanceTransaction" ADD CONSTRAINT "CustomerAdvanceTransaction_advancePaymentId_fkey" FOREIGN KEY ("advancePaymentId") REFERENCES "AdvancePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAdvanceTransaction" ADD CONSTRAINT "CustomerAdvanceTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAdvanceTransaction" ADD CONSTRAINT "CustomerAdvanceTransaction_reversalOfTransactionId_fkey" FOREIGN KEY ("reversalOfTransactionId") REFERENCES "CustomerAdvanceTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
