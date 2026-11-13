-- Supplier Invoice Upload, Admin Verification & Buyer Invoice Generation
--
-- Additive-only migration: introduces SupplierInvoice / SupplierInvoiceLineItem
-- plus the SupplierInvoiceStatus enum, and extends the existing Invoice
-- table with a nullable backend-only cross-reference
-- (supplierInvoiceId) and nullable ship-from/ship-to snapshot columns. No
-- existing table/column is altered destructively, no existing row is
-- modified by this migration — existing Order/Invoice rows are completely
-- unaffected and simply have no associated supplier invoice until a
-- supplier explicitly uploads one (see
-- apps/api/src/supplier/invoices/supplier-invoices.service.ts).

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('PENDING_REVIEW', 'REJECTED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "fileData" BYTEA NOT NULL,
    "fileMimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "supplierInvoiceNumber" TEXT,
    "supplierInvoiceDate" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "freightChargeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherChargesAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "roundingAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "confirmedTaxableValue" DECIMAL(12,2),
    "confirmedTaxAmount" DECIMAL(12,2),
    "confirmedTotalAmount" DECIMAL(12,2),
    "hasDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "discrepancyNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLineItem" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "originalQuantity" INTEGER NOT NULL,
    "originalUnitPrice" DECIMAL(12,2) NOT NULL,
    "actualQuantity" DECIMAL(14,3) NOT NULL,
    "approvedUnitPrice" DECIMAL(12,2) NOT NULL,
    "supplierInvoicedUnitPrice" DECIMAL(12,2),
    "rateDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "taxRatePercent" DECIMAL(5,2),
    "lineSubtotal" DECIMAL(12,2) NOT NULL,
    "lineTaxAmount" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- AlterTable: widen InvoiceLineItem.quantity from INTEGER to DECIMAL(14,3)
-- to support a fractional ACTUAL invoiced quantity/weight (e.g. a
-- weighbridge reading) entered during Admin review — every existing
-- whole-number value converts losslessly.
ALTER TABLE "InvoiceLineItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3);

-- AlterTable: unit-of-measure display/validation fix — a frozen
-- authoritative unit-label snapshot per reviewed line, and an explicit
-- admin acknowledgment flag that the entered actualQuantity genuinely
-- uses that unit (no automatic unit-compatibility detection is possible
-- for an opaque uploaded document). Defaulted (NULL / false) so no
-- existing row (there are none yet, since this table is new in this same
-- migration) is affected either way.
ALTER TABLE "SupplierInvoiceLineItem" ADD COLUMN "orderUnitLabel" TEXT;
ALTER TABLE "SupplierInvoiceLineItem" ADD COLUMN "unitConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: financial-transparency fix — explicit invoice-level
-- adjustment fields + a nullable `taxableValue`, so the stored subtotal
-- always equals the sum of this invoice's own line items and any
-- freight/other-charges/discount/rounding is visible as its own figure
-- rather than silently folded into subtotal. Defaulted to 0 (adjustments)
-- / NULL (taxableValue) so every existing Invoice row remains valid and
-- renders identically to before this migration.
ALTER TABLE "Invoice" ADD COLUMN "taxableValue" DECIMAL(12,2);
ALTER TABLE "Invoice" ADD COLUMN "freightChargeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "otherChargesAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "roundingAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable: nullable backend-only cross-reference + ship-from/ship-to
-- snapshot on the existing Invoice table.
ALTER TABLE "Invoice" ADD COLUMN "supplierInvoiceId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipFromAddressLine" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipFromCity" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipFromState" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipFromPincode" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipToAddressLine" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipToCity" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipToState" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipToPincode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_orderId_key" ON "SupplierInvoice"("orderId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_orderId_idx" ON "SupplierInvoice"("orderId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierId_idx" ON "SupplierInvoice"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_purchaseOrderId_idx" ON "SupplierInvoice"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_status_idx" ON "SupplierInvoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceLineItem_supplierInvoiceId_orderItemId_key" ON "SupplierInvoiceLineItem"("supplierInvoiceId", "orderItemId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLineItem_supplierInvoiceId_idx" ON "SupplierInvoiceLineItem"("supplierInvoiceId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLineItem_orderItemId_idx" ON "SupplierInvoiceLineItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_supplierInvoiceId_key" ON "Invoice"("supplierInvoiceId");

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLineItem" ADD CONSTRAINT "SupplierInvoiceLineItem_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLineItem" ADD CONSTRAINT "SupplierInvoiceLineItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
