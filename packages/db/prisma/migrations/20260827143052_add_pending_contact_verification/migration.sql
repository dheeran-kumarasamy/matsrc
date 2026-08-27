-- CreateEnum
CREATE TYPE "ContactVerificationChannel" AS ENUM ('EMAIL', 'PHONE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PendingContactVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "ContactVerificationChannel" NOT NULL,
    "pendingValue" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "otpSalt" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingContactVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingContactVerification_userId_idx" ON "PendingContactVerification"("userId");

-- CreateIndex
CREATE INDEX "PendingContactVerification_expiresAt_idx" ON "PendingContactVerification"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingContactVerification_userId_channel_key" ON "PendingContactVerification"("userId", "channel");

-- AddForeignKey
ALTER TABLE "PendingContactVerification" ADD CONSTRAINT "PendingContactVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing users' current email/phone predate this OTP-verification
-- feature and must not be retroactively treated as "unverified" (that would
-- force every existing account to re-verify on next profile view, which is
-- explicitly out of scope — verification is only required when the value is
-- CHANGED). Mark them verified as of their account creation time.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "email" IS NOT NULL AND "emailVerifiedAt" IS NULL;
UPDATE "User" SET "phoneVerifiedAt" = "createdAt" WHERE "phone" IS NOT NULL AND "phoneVerifiedAt" IS NULL;
