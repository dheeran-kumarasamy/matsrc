-- ICICI Bank Payment Gateway — UAT ONLY.
--
-- Additive-only migration: adds ICICI_ONLINE to the existing PaymentMethod
-- enum (Postgres requires new enum values to be added outside a transaction
-- block, mirroring the existing PENDING_VERIFICATION PaymentStatus addition
-- in 20260922000000_add_payment_verification), plus a brand-new
-- PaymentTransaction table + PaymentTransactionStatus enum. No existing
-- table/column is altered destructively, and the existing bank-transfer
-- (PaymentVerification) flow is completely untouched.
--
-- PRODUCTION SAFETY: this migration only adds schema capacity. It does NOT
-- enable ICICI anywhere — that is strictly gated at the application layer by
-- apps/web/lib/icici/environment.ts's isIciciUatAvailable() guard. Running
-- this migration against the production database is safe and does not turn
-- on ICICI payments in production.

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ICICI_ONLINE';

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('INITIATED', 'REDIRECTED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUND_INITIATED', 'REFUNDED', 'REFUND_FAILED');

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "gateway" TEXT NOT NULL DEFAULT 'ICICI',
    "gatewayEnvironment" TEXT NOT NULL,
    "merchantTxnNo" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "gatewayResponseCode" TEXT,
    "gatewayResponseDescription" TEXT,
    "gatewayTxnId" TEXT,
    "gatewayTxnAuthId" TEXT,
    "paymentMode" TEXT,
    "paymentSubInstrumentType" TEXT,
    "initiationRequest" JSONB,
    "initiationResponse" JSONB,
    "returnPayload" JSONB,
    "statusRequest" JSONB,
    "statusResponse" JSONB,
    "secureHashVerified" BOOLEAN NOT NULL DEFAULT false,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_paymentReference_key" ON "PaymentTransaction"("paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_merchantTxnNo_key" ON "PaymentTransaction"("merchantTxnNo");

-- CreateIndex
CREATE INDEX "PaymentTransaction_orderId_idx" ON "PaymentTransaction"("orderId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_userId_idx" ON "PaymentTransaction"("userId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_idx" ON "PaymentTransaction"("status");

-- CreateIndex
CREATE INDEX "PaymentTransaction_merchantTxnNo_idx" ON "PaymentTransaction"("merchantTxnNo");

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
