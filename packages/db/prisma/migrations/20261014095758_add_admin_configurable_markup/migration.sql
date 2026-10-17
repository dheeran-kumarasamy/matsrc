-- Admin-Configurable Product Markup & Financial Reconciliation
--
-- Additive-only migration. Introduces:
--   - MarkupSetting (global/category/product markup configuration, with
--     explicit isEnabled so a disabled override is distinct from an unset
--     one — see MarkupSetting's schema doc comment).
--   - Nullable supplierUnitPrice/markupPercent/markupAmount snapshot columns
--     on OrderItem (the buyer-facing authoritative pricing record) and
--     InvoiceLineItem (buyer invoice reconciliation traceability).
--   - Nullable buyerUnitPrice/markupPercent/markupAmount snapshot columns on
--     SupplierQuote (traceability only — SupplierQuote.unitPrice itself
--     remains the supplier's own, never-overwritten quotation) and
--     PurchaseOrderLineItem (so the PO's existing BUYER-facing rendering
--     mode can show the correct marked-up figure without altering
--     PurchaseOrderLineItem.unitPrice, which remains the original supplier
--     rate the SUPPLIER-facing document must show).
--
-- No existing table/column is altered destructively and no existing row's
-- data is modified or backfilled by this migration — every new column is
-- nullable with no default that would imply a non-zero markup, so every
-- historical OrderItem/SupplierQuote/PurchaseOrderLineItem/InvoiceLineItem
-- row is completely unaffected and continues to be read exactly as before
-- (application code falls back to treating a NULL supplierUnitPrice as "no
-- markup was ever applied to this historical row", never fabricating one).

-- CreateEnum
CREATE TYPE "MarkupScope" AS ENUM ('GLOBAL', 'CATEGORY', 'PRODUCT');

-- AlterTable
ALTER TABLE "InvoiceLineItem" ADD COLUMN     "markupAmount" DECIMAL(12,2),
ADD COLUMN     "markupPercent" DECIMAL(5,2),
ADD COLUMN     "supplierUnitPrice" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "markupAmount" DECIMAL(12,2),
ADD COLUMN     "markupPercent" DECIMAL(5,2),
ADD COLUMN     "supplierUnitPrice" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "PurchaseOrderLineItem" ADD COLUMN     "buyerUnitPrice" DECIMAL(12,2),
ADD COLUMN     "markupAmount" DECIMAL(12,2),
ADD COLUMN     "markupPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "SupplierQuote" ADD COLUMN     "buyerUnitPrice" DECIMAL(12,2),
ADD COLUMN     "markupAmount" DECIMAL(12,2),
ADD COLUMN     "markupPercent" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "MarkupSetting" (
    "id" TEXT NOT NULL,
    "scope" "MarkupScope" NOT NULL,
    "scopeId" TEXT,
    "percentage" DECIMAL(5,2) NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkupSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarkupSetting_scope_idx" ON "MarkupSetting"("scope");

-- CreateIndex
CREATE INDEX "MarkupSetting_scopeId_idx" ON "MarkupSetting"("scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "MarkupSetting_scope_scopeId_key" ON "MarkupSetting"("scope", "scopeId");
