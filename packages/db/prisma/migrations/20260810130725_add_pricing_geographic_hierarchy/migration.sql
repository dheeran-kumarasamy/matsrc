-- Phase 6F — Geographic Pricing Hierarchy
--
-- Pre-migration verification (see docs/pricing/geographic-pricing-implementation-report.md):
--   pricing_observation:            0 rows
--   pricing_district_price_daily:   0 rows
--   pricing_trend_monthly:          0 rows
--   pricing_alert_evaluation:       0 rows
--   pricing_raw_observation:        23 rows (all JINDAL_PANTHER, rawLocationText='Delhi', parseStatus=PENDING)
--   pricing_district:               38 rows (all Tamil Nadu, per districts.json — never any other state)
--
-- Because the four serving/normalized-layer tables are empty, this migration
-- carries zero risk of misclassifying real historical district data. The
-- only real backfill is pricing_district.stateId -> Tamil Nadu, which is a
-- safe, deterministic operation because this table has only ever contained
-- Tamil Nadu districts (see packages/db/prisma/seeds/pricing/districts.json
-- and the model comment "All 38 TN districts"). The 23 pending JINDAL raw
-- rows are left completely untouched — they remain parseStatus=PENDING with
-- rawLocationText='Delhi', and nothing in this migration or its seed
-- normalizes them into any PricingObservation/geography.

-- CreateEnum
CREATE TYPE "pricing_geography_level" AS ENUM ('DISTRICT', 'STATE', 'NATIONAL');

-- CreateTable
CREATE TABLE "pricing_state" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_state_code_key" ON "pricing_state"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_state_name_key" ON "pricing_state"("name");

-- Seed the single state every existing PricingDistrict row belongs to.
-- This is a deterministic backfill, not speculative geographic expansion —
-- no other state row is created here (see spec §33/§43: Delhi/JINDAL must
-- NOT get a state row fabricated as part of this migration).
INSERT INTO "pricing_state" ("id", "code", "name", "createdAt", "updatedAt")
VALUES ('pgstate_tamil_nadu', 'TN', 'Tamil Nadu', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable: pricing_district — add stateId nullable, backfill, then enforce NOT NULL.
ALTER TABLE "pricing_district" ADD COLUMN "stateId" TEXT;

UPDATE "pricing_district" SET "stateId" = 'pgstate_tamil_nadu' WHERE "stateId" IS NULL;

ALTER TABLE "pricing_district" ALTER COLUMN "stateId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "pricing_district_stateId_idx" ON "pricing_district"("stateId");

-- AddForeignKey
ALTER TABLE "pricing_district" ADD CONSTRAINT "pricing_district_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "pricing_state"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: pricing_source_endpoint — additive, source-declared geography
-- (nullable/UNRESOLVED-safe; not backfilled — no existing endpoint has ever
-- declared an explicit geographyLevel, so leaving these null is the only
-- honest state, never guessed from districtId or company address).
ALTER TABLE "pricing_source_endpoint" ADD COLUMN "geographyLevel" "pricing_geography_level",
ADD COLUMN "stateId" TEXT;

-- CreateIndex
CREATE INDEX "pricing_source_endpoint_stateId_geographyLevel_idx" ON "pricing_source_endpoint"("stateId", "geographyLevel");

-- AddForeignKey
ALTER TABLE "pricing_source_endpoint" ADD CONSTRAINT "pricing_source_endpoint_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "pricing_state"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: pricing_raw_observation — additive, source-declared raw
-- geography evidence. Not backfilled: none of the 23 existing PENDING rows
-- have an explicit source-declared geography level (their rawLocationText
-- is a free-text city/state mention only, "Delhi") — fabricating
-- rawGeographyLevel from that text would violate spec §10/§12, so it is
-- left NULL for all pre-existing rows.
ALTER TABLE "pricing_raw_observation" ADD COLUMN "rawGeographyLevel" "pricing_geography_level";

-- AlterTable: pricing_observation — add geography columns nullable first
-- (table has 0 rows verified pre-migration, so no backfill is actually
-- needed, but the add-nullable-then-tighten sequence + UPDATE is kept for
-- consistency/safety and to document that emptiness was verified, not
-- assumed).
ALTER TABLE "pricing_observation" ADD COLUMN "geographyLevel" "pricing_geography_level",
ADD COLUMN "stateId" TEXT;
ALTER TABLE "pricing_observation" ALTER COLUMN "districtId" DROP NOT NULL;

UPDATE "pricing_observation" SET "geographyLevel" = 'DISTRICT', "stateId" = (
  SELECT "stateId" FROM "pricing_district" WHERE "pricing_district"."id" = "pricing_observation"."districtId"
) WHERE "geographyLevel" IS NULL AND "districtId" IS NOT NULL;

ALTER TABLE "pricing_observation" ALTER COLUMN "geographyLevel" SET NOT NULL;

ALTER TABLE "pricing_observation" DROP CONSTRAINT "pricing_observation_districtId_fkey";
ALTER TABLE "pricing_observation" ADD CONSTRAINT "pricing_observation_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "pricing_district"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pricing_observation" ADD CONSTRAINT "pricing_observation_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "pricing_state"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "pricing_observation_canonicalSkuId_geographyLevel_stateId_d_idx" ON "pricing_observation"("canonicalSkuId", "geographyLevel", "stateId", "districtId", "isExcluded", "fetchedAt" DESC);

-- Data-integrity CHECK constraint (spec §8/§47): enforces the exact
-- geographyLevel <-> stateId/districtId combination at the DB level, so no
-- application bug can ever write a STATE row with districtId populated or a
-- NATIONAL row with stateId populated.
ALTER TABLE "pricing_observation" ADD CONSTRAINT "pricing_observation_geography_consistency_check" CHECK (
  ("geographyLevel" = 'DISTRICT' AND "stateId" IS NOT NULL AND "districtId" IS NOT NULL) OR
  ("geographyLevel" = 'STATE' AND "stateId" IS NOT NULL AND "districtId" IS NULL) OR
  ("geographyLevel" = 'NATIONAL' AND "stateId" IS NULL AND "districtId" IS NULL)
);

-- AlterTable: pricing_district_price_daily — same pattern as pricing_observation.
ALTER TABLE "pricing_district_price_daily" ADD COLUMN "geographyLevel" "pricing_geography_level",
ADD COLUMN "stateId" TEXT,
ADD COLUMN "geoKey" TEXT;
ALTER TABLE "pricing_district_price_daily" ALTER COLUMN "districtId" DROP NOT NULL;

UPDATE "pricing_district_price_daily" SET "geographyLevel" = 'DISTRICT', "stateId" = (
  SELECT "stateId" FROM "pricing_district" WHERE "pricing_district"."id" = "pricing_district_price_daily"."districtId"
), "geoKey" = "districtId" WHERE "geographyLevel" IS NULL AND "districtId" IS NOT NULL;

ALTER TABLE "pricing_district_price_daily" ALTER COLUMN "geographyLevel" SET NOT NULL;
ALTER TABLE "pricing_district_price_daily" ALTER COLUMN "geoKey" SET NOT NULL;

ALTER TABLE "pricing_district_price_daily" DROP CONSTRAINT "pricing_district_price_daily_districtId_fkey";
ALTER TABLE "pricing_district_price_daily" ADD CONSTRAINT "pricing_district_price_daily_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "pricing_district"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pricing_district_price_daily" ADD CONSTRAINT "pricing_district_price_daily_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "pricing_state"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropIndex (old district-only uniqueness, replaced by geoKey-based uniqueness)
DROP INDEX "pricing_district_price_daily_canonicalSkuId_districtId_pric_key";

-- CreateIndex
CREATE UNIQUE INDEX "pricing_district_price_daily_canonicalSkuId_geoKey_priceDat_key" ON "pricing_district_price_daily"("canonicalSkuId", "geoKey", "priceDate");

-- CreateIndex
CREATE INDEX "pricing_district_price_daily_canonicalSkuId_geographyLevel__idx" ON "pricing_district_price_daily"("canonicalSkuId", "geographyLevel", "stateId", "districtId", "priceDate" DESC);

ALTER TABLE "pricing_district_price_daily" ADD CONSTRAINT "pricing_district_price_daily_geography_consistency_check" CHECK (
  ("geographyLevel" = 'DISTRICT' AND "stateId" IS NOT NULL AND "districtId" IS NOT NULL) OR
  ("geographyLevel" = 'STATE' AND "stateId" IS NOT NULL AND "districtId" IS NULL) OR
  ("geographyLevel" = 'NATIONAL' AND "stateId" IS NULL AND "districtId" IS NULL)
);

-- AlterTable: pricing_trend_monthly — same pattern.
ALTER TABLE "pricing_trend_monthly" ADD COLUMN "geographyLevel" "pricing_geography_level",
ADD COLUMN "stateId" TEXT,
ADD COLUMN "geoKey" TEXT;
ALTER TABLE "pricing_trend_monthly" ALTER COLUMN "districtId" DROP NOT NULL;

UPDATE "pricing_trend_monthly" SET "geographyLevel" = 'DISTRICT', "stateId" = (
  SELECT "stateId" FROM "pricing_district" WHERE "pricing_district"."id" = "pricing_trend_monthly"."districtId"
), "geoKey" = "districtId" WHERE "geographyLevel" IS NULL AND "districtId" IS NOT NULL;

ALTER TABLE "pricing_trend_monthly" ALTER COLUMN "geographyLevel" SET NOT NULL;
ALTER TABLE "pricing_trend_monthly" ALTER COLUMN "geoKey" SET NOT NULL;

ALTER TABLE "pricing_trend_monthly" ADD CONSTRAINT "pricing_trend_monthly_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "pricing_district"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pricing_trend_monthly" ADD CONSTRAINT "pricing_trend_monthly_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "pricing_state"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- DropIndex (old district-only uniqueness, replaced by geoKey-based uniqueness)
DROP INDEX "pricing_trend_monthly_canonicalSkuId_districtId_monthStart_key";

-- CreateIndex
CREATE UNIQUE INDEX "pricing_trend_monthly_canonicalSkuId_geoKey_monthStart_key" ON "pricing_trend_monthly"("canonicalSkuId", "geoKey", "monthStart");

-- CreateIndex
CREATE INDEX "pricing_trend_monthly_canonicalSkuId_geographyLevel_stateId_idx" ON "pricing_trend_monthly"("canonicalSkuId", "geographyLevel", "stateId", "districtId", "monthStart" DESC);

ALTER TABLE "pricing_trend_monthly" ADD CONSTRAINT "pricing_trend_monthly_geography_consistency_check" CHECK (
  ("geographyLevel" = 'DISTRICT' AND "stateId" IS NOT NULL AND "districtId" IS NOT NULL) OR
  ("geographyLevel" = 'STATE' AND "stateId" IS NOT NULL AND "districtId" IS NULL) OR
  ("geographyLevel" = 'NATIONAL' AND "stateId" IS NULL AND "districtId" IS NULL)
);

-- AlterTable: pricing_alert_evaluation — geographyLevel/stateId are nullable
-- (this table records which geography actually backed an alert; a
-- suppressed evaluation with no resolved price has no geography to record,
-- so NULL here means "not applicable", never "DISTRICT by default"). 0 rows
-- exist today, so no backfill is required.
ALTER TABLE "pricing_alert_evaluation" ADD COLUMN "geographyLevel" "pricing_geography_level",
ADD COLUMN "stateId" TEXT;
ALTER TABLE "pricing_alert_evaluation" ALTER COLUMN "districtId" DROP NOT NULL;

ALTER TABLE "pricing_alert_evaluation" ADD CONSTRAINT "pricing_alert_evaluation_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "pricing_state"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Looser CHECK here: geographyLevel is nullable (suppressed-before-resolution
-- rows), but whenever it IS set, the same DISTRICT/STATE/NATIONAL
-- consistency rule from the other tables applies.
ALTER TABLE "pricing_alert_evaluation" ADD CONSTRAINT "pricing_alert_evaluation_geography_consistency_check" CHECK (
  "geographyLevel" IS NULL OR
  ("geographyLevel" = 'DISTRICT' AND "stateId" IS NOT NULL AND "districtId" IS NOT NULL) OR
  ("geographyLevel" = 'STATE' AND "stateId" IS NOT NULL AND "districtId" IS NULL) OR
  ("geographyLevel" = 'NATIONAL' AND "stateId" IS NULL AND "districtId" IS NULL)
);

