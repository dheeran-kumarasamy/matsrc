-- Admin-Curated Supplier Quote Review & Markup Curation
--
-- Additive migration. Introduces:
--   - SupplierQuoteStatus enum ('PENDING_ADMIN_REVIEW', 'SENT_TO_BUYER', 'REJECTED')
--   - status, sentToBuyerAt, reviewedByAdminId, adminNotes columns on SupplierQuote
--   - selectedQuoteId column on Order
--   - Index on SupplierQuote(enquiryId, status)

-- CreateEnum
CREATE TYPE "SupplierQuoteStatus" AS ENUM ('PENDING_ADMIN_REVIEW', 'SENT_TO_BUYER', 'REJECTED');

-- AlterTable
ALTER TABLE "SupplierQuote" ADD COLUMN "status" "SupplierQuoteStatus" NOT NULL DEFAULT 'PENDING_ADMIN_REVIEW',
ADD COLUMN "sentToBuyerAt" TIMESTAMP(3),
ADD COLUMN "reviewedByAdminId" TEXT,
ADD COLUMN "adminNotes" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "selectedQuoteId" TEXT;

-- CreateIndex
CREATE INDEX "SupplierQuote_enquiryId_status_idx" ON "SupplierQuote"("enquiryId", "status");

-- Backfill: historical quotes that were already accepted or marked up are set to SENT_TO_BUYER
UPDATE "SupplierQuote"
SET "status" = 'SENT_TO_BUYER'
WHERE "buyerUnitPrice" IS NOT NULL;
