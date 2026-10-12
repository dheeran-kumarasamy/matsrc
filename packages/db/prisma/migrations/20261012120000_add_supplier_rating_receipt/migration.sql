-- Additive-only migration: adds optional receipt-copy fields to
-- SupplierRating. No existing column is altered or dropped, every new
-- column is nullable, and no existing SupplierRating row is modified by
-- this migration — all existing ratings (with or without a receipt)
-- remain fully valid and unaffected. Mirrors the same private-bytes-in-
-- Postgres storage pattern already used by PaymentVerification
-- (screenshotData/screenshotMimeType/screenshotFileName/screenshotSize).
ALTER TABLE "SupplierRating" ADD COLUMN "receiptData" BYTEA;
ALTER TABLE "SupplierRating" ADD COLUMN "receiptMimeType" TEXT;
ALTER TABLE "SupplierRating" ADD COLUMN "receiptFileName" TEXT;
ALTER TABLE "SupplierRating" ADD COLUMN "receiptSize" INTEGER;
ALTER TABLE "SupplierRating" ADD COLUMN "receiptUploadedAt" TIMESTAMP(3);
