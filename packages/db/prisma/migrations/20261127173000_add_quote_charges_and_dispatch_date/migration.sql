-- Add optional quotation logistics/ancillary charges (freight, loading, unloading, other)
-- and dispatch date to SupplierQuote and Order.

ALTER TABLE "SupplierQuote"
  ADD COLUMN IF NOT EXISTS "freightCharges" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "loadingCharges" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "unloadingCharges" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "otherCharges" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "dispatchDate" TIMESTAMP(3);

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "freightCharges" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "loadingCharges" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "unloadingCharges" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "otherCharges" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dispatchDate" TIMESTAMP(3);
