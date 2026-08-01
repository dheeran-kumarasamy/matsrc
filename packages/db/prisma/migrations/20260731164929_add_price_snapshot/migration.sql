-- CreateEnum
CREATE TYPE "PriceSnapshotSource" AS ENUM ('LISTING', 'RFQ_ACCEPTED', 'ORDER');

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "canonicalProductId" TEXT,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "unit" TEXT,
    "region" TEXT,
    "source" "PriceSnapshotSource" NOT NULL,
    "sourceRefId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceSnapshot_canonicalProductId_capturedAt_idx" ON "PriceSnapshot"("canonicalProductId", "capturedAt");

-- CreateIndex
CREATE INDEX "PriceSnapshot_productId_capturedAt_idx" ON "PriceSnapshot"("productId", "capturedAt");

-- CreateIndex
CREATE INDEX "PriceSnapshot_supplierId_idx" ON "PriceSnapshot"("supplierId");

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
