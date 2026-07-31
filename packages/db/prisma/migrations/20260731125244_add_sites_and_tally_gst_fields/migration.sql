-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "taxRatePercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "hsnCode" TEXT;

-- AlterTable
ALTER TABLE "SupplierProfile" ADD COLUMN     "gstin" TEXT;

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gstin" TEXT,
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyLedgerMapping" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "purchaseLedger" TEXT NOT NULL DEFAULT 'Purchase Account',
    "cgstLedger" TEXT NOT NULL DEFAULT 'CGST',
    "sgstLedger" TEXT NOT NULL DEFAULT 'SGST',
    "igstLedger" TEXT NOT NULL DEFAULT 'IGST',
    "roundOffLedger" TEXT NOT NULL DEFAULT 'Round Off',
    "supplierLedgerMap" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyLedgerMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Site_builderId_idx" ON "Site"("builderId");

-- CreateIndex
CREATE INDEX "Site_builderId_status_idx" ON "Site"("builderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Site_builderId_name_key" ON "Site"("builderId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TallyLedgerMapping_builderId_key" ON "TallyLedgerMapping"("builderId");

-- CreateIndex
CREATE INDEX "Order_siteId_idx" ON "Order"("siteId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyLedgerMapping" ADD CONSTRAINT "TallyLedgerMapping_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
