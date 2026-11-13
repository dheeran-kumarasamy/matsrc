-- Supplier RFQ Price Revision & GST-Inclusive Order Value.
--
-- Adds the RFQ-specific GST/line-total breakdown to SupplierQuote so a
-- supplier's submitted quotation (including the server-calculated GST
-- amount and line total at the time of submission) can always be
-- reproduced later, independent of any subsequent catalogue price or GST
-- rate change. All columns are nullable/additive (no NOT NULL, no default
-- required) so every existing SupplierQuote row remains valid and loadable
-- without a backfill — see SupplierQuote's doc comment in schema.prisma.

-- AlterTable
ALTER TABLE "SupplierQuote"
  ADD COLUMN IF NOT EXISTS "quantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "gstRatePercent" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "lineSubtotal" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "gstAmount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "lineTotal" DECIMAL(14,2);
