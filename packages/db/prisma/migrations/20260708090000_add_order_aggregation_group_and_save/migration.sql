-- CreateEnum
CREATE TYPE "AggregationPoolStatus" AS ENUM ('OPEN', 'LOCKED', 'FULFILLING', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AggregationParticipantStatus" AS ENUM ('PENDING', 'LOCKED_IN', 'CONVERTED', 'OPTED_OUT');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "aggregationPoolId" TEXT,
ADD COLUMN     "isAggregated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceAfterAggregation" DECIMAL(12,2),
ADD COLUMN     "priceBeforeAggregation" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aggregationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aggregationPriceTiers" JSONB,
ADD COLUMN     "aggregationWindowDays" INTEGER DEFAULT 7,
ADD COLUMN     "aggregationZoneRules" JSONB;

-- CreateTable
CREATE TABLE "AggregationPool" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "zoneKey" TEXT NOT NULL,
    "deliveryWindowStart" TIMESTAMP(3) NOT NULL,
    "deliveryWindowEnd" TIMESTAMP(3) NOT NULL,
    "status" "AggregationPoolStatus" NOT NULL DEFAULT 'OPEN',
    "currentQuantity" INTEGER NOT NULL DEFAULT 0,
    "priceTiers" JSONB NOT NULL,
    "lockedUnitPrice" DECIMAL(12,2),
    "windowCloseAt" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregationPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregationParticipant" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "orderId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "AggregationParticipantStatus" NOT NULL DEFAULT 'PENDING',
    "optedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optedOutAt" TIMESTAMP(3),

    CONSTRAINT "AggregationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AggregationPool_supplierId_idx" ON "AggregationPool"("supplierId");

-- CreateIndex
CREATE INDEX "AggregationPool_productId_zoneKey_status_idx" ON "AggregationPool"("productId", "zoneKey", "status");

-- CreateIndex
CREATE INDEX "AggregationPool_status_idx" ON "AggregationPool"("status");

-- CreateIndex
CREATE INDEX "AggregationPool_windowCloseAt_idx" ON "AggregationPool"("windowCloseAt");

-- CreateIndex
CREATE UNIQUE INDEX "AggregationParticipant_orderId_key" ON "AggregationParticipant"("orderId");

-- CreateIndex
CREATE INDEX "AggregationParticipant_poolId_idx" ON "AggregationParticipant"("poolId");

-- CreateIndex
CREATE INDEX "AggregationParticipant_builderId_idx" ON "AggregationParticipant"("builderId");

-- CreateIndex
CREATE INDEX "AggregationParticipant_poolId_status_idx" ON "AggregationParticipant"("poolId", "status");

-- CreateIndex
CREATE INDEX "Order_aggregationPoolId_idx" ON "Order"("aggregationPoolId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_aggregationPoolId_fkey" FOREIGN KEY ("aggregationPoolId") REFERENCES "AggregationPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregationPool" ADD CONSTRAINT "AggregationPool_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregationPool" ADD CONSTRAINT "AggregationPool_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregationParticipant" ADD CONSTRAINT "AggregationParticipant_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "AggregationPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregationParticipant" ADD CONSTRAINT "AggregationParticipant_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregationParticipant" ADD CONSTRAINT "AggregationParticipant_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
