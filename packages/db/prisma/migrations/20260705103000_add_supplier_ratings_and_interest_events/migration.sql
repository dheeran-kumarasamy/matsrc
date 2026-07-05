-- CreateEnum
CREATE TYPE "ProductInterestEventType" AS ENUM ('VIEW', 'CART_ADD', 'ORDER_PLACED');

-- CreateTable
CREATE TABLE "SupplierRating" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "deliveryRating" INTEGER NOT NULL,
    "qualityRating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductInterestEvent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" "ProductInterestEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductInterestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRating_orderId_key" ON "SupplierRating"("orderId");

-- CreateIndex
CREATE INDEX "SupplierRating_supplierId_idx" ON "SupplierRating"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierRating_builderId_idx" ON "SupplierRating"("builderId");

-- CreateIndex
CREATE INDEX "ProductInterestEvent_listingId_eventType_createdAt_idx" ON "ProductInterestEvent"("listingId", "eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "SupplierRating" ADD CONSTRAINT "SupplierRating_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRating" ADD CONSTRAINT "SupplierRating_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRating" ADD CONSTRAINT "SupplierRating_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductInterestEvent" ADD CONSTRAINT "ProductInterestEvent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
