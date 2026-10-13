-- Purely additive: adds the GST tax rate PERCENTAGE alongside the already
-- existing computed tax AMOUNT on PurchaseOrderLineItem, mirroring
-- OrderItem.taxRatePercent / InvoiceLineItem.taxRate. Nullable so every
-- existing row remains valid without a backfill value, and no existing
-- data is modified. See PurchaseOrderLineItem's doc comment in
-- schema.prisma for the full rationale.

-- AlterTable
ALTER TABLE "PurchaseOrderLineItem" ADD COLUMN "taxRatePercent" DECIMAL(5,2);
