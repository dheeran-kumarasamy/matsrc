-- CreateEnum
CREATE TYPE "OrderItemCandidateStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "allCandidatesDeclined" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrderItemSupplierCandidate" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "listingId" TEXT,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "rank" INTEGER NOT NULL,
    "status" "OrderItemCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "declineReason" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemSupplierCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderItemSupplierCandidate_orderItemId_idx" ON "OrderItemSupplierCandidate"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemSupplierCandidate_supplierId_idx" ON "OrderItemSupplierCandidate"("supplierId");

-- CreateIndex
CREATE INDEX "OrderItemSupplierCandidate_orderItemId_status_idx" ON "OrderItemSupplierCandidate"("orderItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemSupplierCandidate_orderItemId_supplierId_key" ON "OrderItemSupplierCandidate"("orderItemId", "supplierId");

-- AddForeignKey
ALTER TABLE "OrderItemSupplierCandidate" ADD CONSTRAINT "OrderItemSupplierCandidate_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemSupplierCandidate" ADD CONSTRAINT "OrderItemSupplierCandidate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
