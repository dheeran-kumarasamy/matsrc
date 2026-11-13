-- C20 + C37 shared, purpose-bound OTP challenge store.
-- Hand-authored (not `prisma migrate dev`, which requires an interactive
-- TTY unavailable in this environment) to contain ONLY the OtpChallenge
-- addition — unrelated pre-existing schema drift (orderNumber/
-- BusinessSequence from a separate, already-in-progress feature branch) is
-- deliberately excluded per task scope restrictions.

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN_OTP', 'PO_APPROVAL_OTP');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "OtpDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'NOT_CONFIGURED');

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "userId" TEXT,
    "identifier" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "otpHash" TEXT NOT NULL,
    "otpSalt" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "channel" "OtpChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "deliveryStatus" "OtpDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpChallenge_userId_idx" ON "OtpChallenge"("userId");

-- CreateIndex
CREATE INDEX "OtpChallenge_purpose_idx" ON "OtpChallenge"("purpose");

-- CreateIndex
CREATE INDEX "OtpChallenge_identifier_idx" ON "OtpChallenge"("identifier");

-- CreateIndex
CREATE INDEX "OtpChallenge_purchaseOrderId_idx" ON "OtpChallenge"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_purpose_identifier_idx" ON "OtpChallenge"("purpose", "identifier");

-- CreateIndex
CREATE INDEX "OtpChallenge_purpose_purchaseOrderId_idx" ON "OtpChallenge"("purpose", "purchaseOrderId");

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
