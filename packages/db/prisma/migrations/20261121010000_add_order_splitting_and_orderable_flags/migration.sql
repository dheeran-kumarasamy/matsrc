-- Add Order Splitting Configuration and Customer Ordering Flags on Category & Product
--
-- Additive migration. Introduces:
--   - isOrderable column on Category (default true)
--   - isOrderable column on Product (default true)
--   - OrderSplittingConfig table with global default (allowMultiSupplierSplitting = false, splitOnlyAcrossCategories = true)

-- AlterTable Category
ALTER TABLE "Category" ADD COLUMN "isOrderable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable Product
ALTER TABLE "Product" ADD COLUMN "isOrderable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "OrderSplittingConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "allowMultiSupplierSplitting" BOOLEAN NOT NULL DEFAULT false,
    "splitOnlyAcrossCategories" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "OrderSplittingConfig_pkey" PRIMARY KEY ("id")
);

-- Insert default row
INSERT INTO "OrderSplittingConfig" ("id", "allowMultiSupplierSplitting", "splitOnlyAcrossCategories", "updatedAt")
VALUES ('global', false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
