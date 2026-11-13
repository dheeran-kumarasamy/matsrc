-- CreateEnum
CREATE TYPE "TaxScope" AS ENUM ('GLOBAL', 'CATEGORY', 'PRODUCT');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "advancePercent" DECIMAL(5,2),
ADD COLUMN     "finalPayableAmount" DECIMAL(12,2),
ADD COLUMN     "requiredAdvanceAmount" DECIMAL(12,2),
ADD COLUMN     "taxAmount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "taxAmount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "TaxSetting" (
    "id" TEXT NOT NULL,
    "scope" "TaxScope" NOT NULL,
    "scopeId" TEXT,
    "percentage" DECIMAL(5,2) NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "percentage" DECIMAL(5,2) NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AdvanceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxSetting_scope_idx" ON "TaxSetting"("scope");

-- CreateIndex
CREATE INDEX "TaxSetting_scopeId_idx" ON "TaxSetting"("scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxSetting_scope_scopeId_key" ON "TaxSetting"("scope", "scopeId");
