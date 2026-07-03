/*
  Warnings:

  - Added the required column `updatedAt` to the `Notification` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "NotificationTemplateType" AS ENUM ('ORDER_SUBMITTED', 'ORDER_ACCEPTED', 'ORDER_DECLINED', 'ORDER_DISPATCHED', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'PAYMENT_UNLOCKED', 'PAYMENT_REMINDER', 'RFQ_QUOTE_SHARED', 'DISPUTE_CREATED', 'DISPUTE_RESOLVED', 'KYC_APPROVED', 'KYC_REJECTED', 'WATCHLIST_ALERT');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "maxRetries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "templateType" "NotificationTemplateType",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "variables" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "maxServiceableQty" INTEGER;

-- CreateTable
CREATE TABLE "AdminCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminMenuPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "menu" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMenuPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingTier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "maxQty" INTEGER NOT NULL,
    "tierPrice" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "type" "NotificationTemplateType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "language" TEXT NOT NULL DEFAULT 'en',
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDeliveryLog" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "provider" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminCredential_userId_key" ON "AdminCredential"("userId");

-- CreateIndex
CREATE INDEX "AdminMenuPermission_userId_idx" ON "AdminMenuPermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminMenuPermission_userId_menu_key" ON "AdminMenuPermission"("userId", "menu");

-- CreateIndex
CREATE INDEX "PricingTier_productId_idx" ON "PricingTier"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingTier_productId_minQty_maxQty_key" ON "PricingTier"("productId", "minQty", "maxQty");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_type_key" ON "NotificationTemplate"("type");

-- CreateIndex
CREATE INDEX "NotificationTemplate_type_idx" ON "NotificationTemplate"("type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_type_channel_language_version_key" ON "NotificationTemplate"("type", "channel", "language", "version");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_notificationId_idx" ON "NotificationDeliveryLog"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_newStatus_idx" ON "NotificationDeliveryLog"("newStatus");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "Notification_externalId_idx" ON "Notification"("externalId");

-- AddForeignKey
ALTER TABLE "AdminCredential" ADD CONSTRAINT "AdminCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminMenuPermission" ADD CONSTRAINT "AdminMenuPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTier" ADD CONSTRAINT "PricingTier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
