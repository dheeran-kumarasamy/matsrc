-- Meaningful Enquiry ID
--
-- Adds the additive fields needed to generate a human-readable enquiry ID
-- ("<CONTRACTOR_CODE>-<SITE_CODE>-<SEQUENCE>", e.g. "ABC-SITE01-000123")
-- alongside the existing Order.id (cuid) primary key, which remains the
-- real database identifier / FK target / URL param everywhere and is
-- never modified by this migration.

-- AlterTable: stable, immutable-once-set contractor code on User.
ALTER TABLE "User" ADD COLUMN "builderCode" TEXT;
CREATE UNIQUE INDEX "User_builderCode_key" ON "User"("builderCode");

-- CreateTable: global, transaction-safe sequence counter for the numeric
-- part of the enquiry ID. Single row, id = 'singleton'.
CREATE TABLE "EnquirySequence" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EnquirySequence_pkey" PRIMARY KEY ("id")
);

INSERT INTO "EnquirySequence" ("id", "value") VALUES ('singleton', 0);

-- AlterTable: display-only enquiry ID on Order.
ALTER TABLE "Order" ADD COLUMN "enquiryId" TEXT;
CREATE UNIQUE INDEX "Order_enquiryId_key" ON "Order"("enquiryId");
