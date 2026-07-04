-- AlterEnum
ALTER TYPE "NotificationTemplateType" ADD VALUE IF NOT EXISTS 'ENQUIRY_SUBMITTED_TO_SUPPLIER';
ALTER TYPE "NotificationTemplateType" ADD VALUE IF NOT EXISTS 'ENQUIRY_BEST_PRICE_TO_BUILDER';

-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "selectedSupplierId" TEXT,
ADD COLUMN "bestPriceTotal" DECIMAL(12,2),
ADD COLUMN "tentativeDeliveryDate" TIMESTAMP(3),
ADD COLUMN "quoteSelectionCompletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notification"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "audience" TEXT;

-- CreateTable
CREATE TABLE "SupplierQuote" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "leadTimeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_selectedSupplierId_idx" ON "Order"("selectedSupplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplierQuote_enquiryId_idx" ON "SupplierQuote"("enquiryId");

-- CreateIndex
CREATE INDEX "SupplierQuote_supplierId_idx" ON "SupplierQuote"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierQuote_lineItemId_idx" ON "SupplierQuote"("lineItemId");

-- CreateIndex
CREATE INDEX "SupplierQuote_enquiryId_lineItemId_idx" ON "SupplierQuote"("enquiryId", "lineItemId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_selectedSupplierId_fkey" FOREIGN KEY ("selectedSupplierId") REFERENCES "SupplierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
