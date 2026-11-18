-- AlterTable Invoice
ALTER TABLE "Invoice" ADD COLUMN "documentType" TEXT NOT NULL DEFAULT 'INV';
ALTER TABLE "Invoice" ADD COLUMN "supplyType" TEXT NOT NULL DEFAULT 'B2B';
ALTER TABLE "Invoice" ADD COLUMN "reverseCharge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN "placeOfSupplyStateCode" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "placeOfSupplyStateName" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "sellerStateCode" TEXT NOT NULL DEFAULT '33';
ALTER TABLE "Invoice" ADD COLUMN "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "cessAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "buyerLegalName" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "buyerTradeName" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "buyerGstin" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "buyerAddressLine" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "buyerCity" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "buyerState" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "buyerPincode" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "buyerStateCode" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "buyerPoNumber" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "ewayBillNumber" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "vehicleNumber" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "transporterName" TEXT;

-- AlterTable InvoiceLineItem
ALTER TABLE "InvoiceLineItem" ADD COLUMN "slNo" INTEGER;
ALTER TABLE "InvoiceLineItem" ADD COLUMN "hsnCode" TEXT;
ALTER TABLE "InvoiceLineItem" ADD COLUMN "uqc" TEXT;
ALTER TABLE "InvoiceLineItem" ADD COLUMN "unit" TEXT;
ALTER TABLE "InvoiceLineItem" ADD COLUMN "isService" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InvoiceLineItem" ADD COLUMN "taxableAmount" DECIMAL(12,2);
ALTER TABLE "InvoiceLineItem" ADD COLUMN "cgstRate" DECIMAL(5,2);
ALTER TABLE "InvoiceLineItem" ADD COLUMN "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceLineItem" ADD COLUMN "sgstRate" DECIMAL(5,2);
ALTER TABLE "InvoiceLineItem" ADD COLUMN "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceLineItem" ADD COLUMN "igstRate" DECIMAL(5,2);
ALTER TABLE "InvoiceLineItem" ADD COLUMN "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceLineItem" ADD COLUMN "cessRate" DECIMAL(5,2);
ALTER TABLE "InvoiceLineItem" ADD COLUMN "cessAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
