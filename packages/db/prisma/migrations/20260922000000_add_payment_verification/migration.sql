-- AlterEnum
-- PENDING_VERIFICATION represents a bank-transfer payment proof that has
-- been uploaded by a customer and is awaiting admin review. Postgres
-- requires new enum values to be added outside a transaction block.
ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING_VERIFICATION';

-- CreateEnum
CREATE TYPE "PaymentVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "PaymentVerification" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "screenshotData" BYTEA NOT NULL,
    "screenshotMimeType" TEXT NOT NULL,
    "screenshotFileName" TEXT NOT NULL,
    "screenshotSize" INTEGER NOT NULL,
    "status" "PaymentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentVerification_orderId_key" ON "PaymentVerification"("orderId");

-- CreateIndex
CREATE INDEX "PaymentVerification_orderId_idx" ON "PaymentVerification"("orderId");

-- CreateIndex
CREATE INDEX "PaymentVerification_userId_idx" ON "PaymentVerification"("userId");

-- CreateIndex
CREATE INDEX "PaymentVerification_status_idx" ON "PaymentVerification"("status");

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
