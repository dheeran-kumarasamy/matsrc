-- CreateEnum
CREATE TYPE "pricing_source_tier" AS ENUM ('GOVERNMENT', 'MANUFACTURER', 'AGGREGATOR', 'MARKETPLACE', 'INTERNAL');

-- CreateEnum
CREATE TYPE "pricing_license_class" AS ENUM ('PUBLIC_DOMAIN', 'ATTRIBUTION_REQUIRED', 'INTERNAL_ONLY', 'OWN_DATA');

-- CreateEnum
CREATE TYPE "pricing_scrape_method" AS ENUM ('APIFY_ACTOR', 'APIFY_CHEERIO', 'APIFY_PLAYWRIGHT', 'PDF_PARSE', 'HTTP_JSON', 'INTERNAL_QUERY');

-- CreateEnum
CREATE TYPE "pricing_run_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'ABORTED');

-- CreateEnum
CREATE TYPE "pricing_parse_status" AS ENUM ('PENDING', 'PARSED', 'REJECTED', 'UNMAPPED', 'QUARANTINED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "pricing_price_type" AS ENUM ('GOVT_SCHEDULE', 'LIST_PRICE', 'TRANSACTED', 'QUOTE', 'INDICATIVE', 'RANGE', 'ON_REQUEST');

-- CreateEnum
CREATE TYPE "pricing_tax_treatment" AS ENUM ('EXCLUSIVE_GST', 'INCLUSIVE_GST', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "pricing_price_method" AS ENUM ('OBSERVED', 'DERIVED_FREIGHT', 'DERIVED_INDEX', 'DERIVED_BLENDED', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "pricing_confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "pricing_base_unit" AS ENUM ('KG', 'TONNE', 'CFT', 'CUM', 'PIECE', 'SQFT', 'LITRE', 'RFT', 'BAG');

-- CreateEnum
CREATE TYPE "pricing_mapping_match_type" AS ENUM ('EXACT', 'NORMALIZED', 'FUZZY', 'MANUAL', 'BLOCKED');

-- CreateEnum
CREATE TYPE "pricing_anomaly_reason" AS ENUM ('OUTLIER_MAD', 'IMPLAUSIBLE_RANGE', 'UNIT_AMBIGUOUS', 'STALE_AS_OF', 'SOURCE_SCHEMA_DRIFT', 'DUPLICATE_SUSPECT');

-- CreateTable
CREATE TABLE "pricing_district" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTa" TEXT,
    "region" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "isMetro" BOOLEAN NOT NULL DEFAULT false,
    "desCentreCode" TEXT,
    "sorAreaSupplementPct" DECIMAL(5,2),
    "anchorDistrictId" TEXT,
    "anchorRoadDistanceKm" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_district_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_cost_index" (
    "id" TEXT NOT NULL,
    "centreCode" TEXT NOT NULL,
    "quarterEndsOn" DATE NOT NULL,
    "materialIndex" DECIMAL(8,2) NOT NULL,
    "labourIndex" DECIMAL(8,2),
    "compositeIndex" DECIMAL(8,2),
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_cost_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_material_category" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "baseUnit" "pricing_base_unit" NOT NULL,
    "displayUnit" "pricing_base_unit" NOT NULL,
    "displayLabel" TEXT,
    "floorPerBaseUnit" DECIMAL(14,4),
    "ceilingPerBaseUnit" DECIMAL(14,4),
    "gstRatePct" DECIMAL(5,2),
    "hsnCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_material_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_brand" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPrimaryMill" BOOLEAN NOT NULL DEFAULT false,
    "isTnBased" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_canonical_sku" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "materialCategoryId" TEXT NOT NULL,
    "brandId" TEXT,
    "grade" TEXT,
    "sizeMm" INTEGER,
    "sizeLabel" TEXT,
    "packLabel" TEXT,
    "fingerprint" TEXT NOT NULL,
    "baseUnit" "pricing_base_unit" NOT NULL,
    "specJson" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "matsrcListingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_canonical_sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_sku_alias" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "rawLabel" TEXT NOT NULL,
    "normalizedLabel" TEXT NOT NULL,
    "canonicalSkuId" TEXT,
    "matchType" "pricing_mapping_match_type" NOT NULL,
    "matchScore" DECIMAL(5,4),
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_sku_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_unit_conversion" (
    "id" TEXT NOT NULL,
    "materialCategoryId" TEXT,
    "fromLabel" TEXT NOT NULL,
    "toBaseUnit" "pricing_base_unit" NOT NULL,
    "factor" DECIMAL(16,6) NOT NULL,
    "isAmbiguous" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_unit_conversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_source" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "pricing_source_tier" NOT NULL,
    "licenseClass" "pricing_license_class" NOT NULL,
    "scrapeMethod" "pricing_scrape_method" NOT NULL,
    "baseUrl" TEXT,
    "robotsAllowed" BOOLEAN NOT NULL DEFAULT false,
    "tosReviewedAt" TIMESTAMP(3),
    "tosReviewNote" TEXT,
    "publicDisplayAllowed" BOOLEAN NOT NULL DEFAULT false,
    "attributionText" TEXT,
    "defaultPriceType" "pricing_price_type" NOT NULL,
    "defaultTaxTreatment" "pricing_tax_treatment" NOT NULL DEFAULT 'UNKNOWN',
    "apifyActorId" TEXT,
    "apifyTaskId" TEXT,
    "cronExpression" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "freshnessSlaHours" INTEGER,
    "trustWeight" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_source_endpoint" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "districtId" TEXT,
    "materialCategoryId" TEXT,
    "url" TEXT NOT NULL,
    "apifyInput" JSONB,
    "lastFetchedAt" TIMESTAMP(3),
    "lastStatus" "pricing_run_status",
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_source_endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_scrape_run" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "apifyRunId" TEXT,
    "apifyActorId" TEXT,
    "apifyDatasetId" TEXT,
    "status" "pricing_run_status" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsFetched" INTEGER NOT NULL DEFAULT 0,
    "itemsParsed" INTEGER NOT NULL DEFAULT 0,
    "itemsRejected" INTEGER NOT NULL DEFAULT 0,
    "itemsUnmapped" INTEGER NOT NULL DEFAULT 0,
    "computeUnits" DECIMAL(12,4),
    "costUsd" DECIMAL(10,4),
    "triggeredBy" TEXT,
    "errorMessage" TEXT,
    "logUrl" TEXT,

    CONSTRAINT "pricing_scrape_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_raw_observation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "rawSkuLabel" TEXT,
    "rawPriceText" TEXT,
    "rawUnitText" TEXT,
    "rawLocationText" TEXT,
    "rawAsOfText" TEXT,
    "rawSupplierName" TEXT,
    "dedupeHash" TEXT NOT NULL,
    "parseStatus" "pricing_parse_status" NOT NULL DEFAULT 'PENDING',
    "parseError" TEXT,

    CONSTRAINT "pricing_raw_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_observation" (
    "id" TEXT NOT NULL,
    "rawId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalSkuId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "matsrcSupplierId" TEXT,
    "quotedPrice" DECIMAL(14,2) NOT NULL,
    "quotedMin" DECIMAL(14,2),
    "quotedMax" DECIMAL(14,2),
    "quotedUnitLabel" TEXT NOT NULL,
    "quotedQty" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "pricePerBaseUnit" DECIMAL(14,4) NOT NULL,
    "baseUnit" "pricing_base_unit" NOT NULL,
    "taxTreatment" "pricing_tax_treatment" NOT NULL,
    "pricePerBaseUnitExGst" DECIMAL(14,4),
    "priceType" "pricing_price_type" NOT NULL,
    "asOfDate" DATE,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "confidence" "pricing_confidence" NOT NULL,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_anomaly" (
    "id" TEXT NOT NULL,
    "observationId" TEXT,
    "sourceId" TEXT,
    "reason" "pricing_anomaly_reason" NOT NULL,
    "detail" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionAction" TEXT,

    CONSTRAINT "pricing_anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_district_price_daily" (
    "id" TEXT NOT NULL,
    "canonicalSkuId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "priceDate" DATE NOT NULL,
    "baseUnit" "pricing_base_unit" NOT NULL,
    "medianPerBaseUnit" DECIMAL(14,4) NOT NULL,
    "p25PerBaseUnit" DECIMAL(14,4),
    "p75PerBaseUnit" DECIMAL(14,4),
    "minPerBaseUnit" DECIMAL(14,4),
    "maxPerBaseUnit" DECIMAL(14,4),
    "medianPerDisplayUnit" DECIMAL(14,4),
    "displayUnit" "pricing_base_unit",
    "observationCount" INTEGER NOT NULL,
    "sourceCount" INTEGER NOT NULL,
    "method" "pricing_price_method" NOT NULL,
    "confidence" "pricing_confidence" NOT NULL,
    "anchorDistrictId" TEXT,
    "derivationJson" JSONB,
    "publicDisplayAllowed" BOOLEAN NOT NULL DEFAULT false,
    "contributingSourceCodes" TEXT[],
    "matsrcMedianPerBaseUnit" DECIMAL(14,4),
    "matsrcQuoteCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_district_price_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_trend_monthly" (
    "id" TEXT NOT NULL,
    "canonicalSkuId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "monthStart" DATE NOT NULL,
    "medianPerBaseUnit" DECIMAL(14,4) NOT NULL,
    "minPerBaseUnit" DECIMAL(14,4),
    "maxPerBaseUnit" DECIMAL(14,4),
    "momChangePct" DECIMAL(7,3),
    "yoyChangePct" DECIMAL(7,3),
    "dayCount" INTEGER NOT NULL,
    "confidence" "pricing_confidence" NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_trend_monthly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_alert_evaluation" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "canonicalSkuId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "targetPricePerBaseUnit" DECIMAL(14,4) NOT NULL,
    "currentPricePerBaseUnit" DECIMAL(14,4) NOT NULL,
    "baseUnit" "pricing_base_unit" NOT NULL,
    "didTrigger" BOOLEAN NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificationId" TEXT,
    "suppressedReason" TEXT,

    CONSTRAINT "pricing_alert_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_district_code_key" ON "pricing_district"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_district_name_key" ON "pricing_district"("name");

-- CreateIndex
CREATE INDEX "pricing_district_desCentreCode_idx" ON "pricing_district"("desCentreCode");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_cost_index_centreCode_quarterEndsOn_key" ON "pricing_cost_index"("centreCode", "quarterEndsOn");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_material_category_code_key" ON "pricing_material_category"("code");

-- CreateIndex
CREATE INDEX "pricing_material_category_parentId_idx" ON "pricing_material_category"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_brand_slug_key" ON "pricing_brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_canonical_sku_code_key" ON "pricing_canonical_sku"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_canonical_sku_fingerprint_key" ON "pricing_canonical_sku"("fingerprint");

-- CreateIndex
CREATE INDEX "pricing_canonical_sku_materialCategoryId_isActive_idx" ON "pricing_canonical_sku"("materialCategoryId", "isActive");

-- CreateIndex
CREATE INDEX "pricing_canonical_sku_brandId_idx" ON "pricing_canonical_sku"("brandId");

-- CreateIndex
CREATE INDEX "pricing_sku_alias_canonicalSkuId_idx" ON "pricing_sku_alias"("canonicalSkuId");

-- CreateIndex
CREATE INDEX "pricing_sku_alias_normalizedLabel_idx" ON "pricing_sku_alias"("normalizedLabel");

-- CreateIndex
CREATE INDEX "pricing_sku_alias_matchType_occurrenceCount_idx" ON "pricing_sku_alias"("matchType", "occurrenceCount" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_sku_alias_sourceId_rawLabel_key" ON "pricing_sku_alias"("sourceId", "rawLabel");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_unit_conversion_materialCategoryId_fromLabel_key" ON "pricing_unit_conversion"("materialCategoryId", "fromLabel");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_source_code_key" ON "pricing_source"("code");

-- CreateIndex
CREATE INDEX "pricing_source_isEnabled_tier_idx" ON "pricing_source"("isEnabled", "tier");

-- CreateIndex
CREATE INDEX "pricing_source_endpoint_isEnabled_lastFetchedAt_idx" ON "pricing_source_endpoint"("isEnabled", "lastFetchedAt");

-- CreateIndex
CREATE INDEX "pricing_source_endpoint_districtId_materialCategoryId_idx" ON "pricing_source_endpoint"("districtId", "materialCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_source_endpoint_sourceId_url_key" ON "pricing_source_endpoint"("sourceId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_scrape_run_apifyRunId_key" ON "pricing_scrape_run"("apifyRunId");

-- CreateIndex
CREATE INDEX "pricing_scrape_run_sourceId_startedAt_idx" ON "pricing_scrape_run"("sourceId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "pricing_scrape_run_status_idx" ON "pricing_scrape_run"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_raw_observation_dedupeHash_key" ON "pricing_raw_observation"("dedupeHash");

-- CreateIndex
CREATE INDEX "pricing_raw_observation_sourceId_fetchedAt_idx" ON "pricing_raw_observation"("sourceId", "fetchedAt" DESC);

-- CreateIndex
CREATE INDEX "pricing_raw_observation_parseStatus_fetchedAt_idx" ON "pricing_raw_observation"("parseStatus", "fetchedAt");

-- CreateIndex
CREATE INDEX "pricing_raw_observation_runId_idx" ON "pricing_raw_observation"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_observation_rawId_key" ON "pricing_observation"("rawId");

-- CreateIndex
CREATE INDEX "pricing_observation_canonicalSkuId_districtId_asOfDate_idx" ON "pricing_observation"("canonicalSkuId", "districtId", "asOfDate" DESC);

-- CreateIndex
CREATE INDEX "pricing_observation_canonicalSkuId_districtId_isExcluded_fe_idx" ON "pricing_observation"("canonicalSkuId", "districtId", "isExcluded", "fetchedAt" DESC);

-- CreateIndex
CREATE INDEX "pricing_observation_sourceId_fetchedAt_idx" ON "pricing_observation"("sourceId", "fetchedAt" DESC);

-- CreateIndex
CREATE INDEX "pricing_observation_matsrcSupplierId_idx" ON "pricing_observation"("matsrcSupplierId");

-- CreateIndex
CREATE INDEX "pricing_anomaly_resolvedAt_detectedAt_idx" ON "pricing_anomaly"("resolvedAt", "detectedAt");

-- CreateIndex
CREATE INDEX "pricing_anomaly_reason_idx" ON "pricing_anomaly"("reason");

-- CreateIndex
CREATE INDEX "pricing_district_price_daily_districtId_priceDate_publicDis_idx" ON "pricing_district_price_daily"("districtId", "priceDate" DESC, "publicDisplayAllowed");

-- CreateIndex
CREATE INDEX "pricing_district_price_daily_canonicalSkuId_priceDate_idx" ON "pricing_district_price_daily"("canonicalSkuId", "priceDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_district_price_daily_canonicalSkuId_districtId_pric_key" ON "pricing_district_price_daily"("canonicalSkuId", "districtId", "priceDate");

-- CreateIndex
CREATE INDEX "pricing_trend_monthly_districtId_monthStart_idx" ON "pricing_trend_monthly"("districtId", "monthStart" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_trend_monthly_canonicalSkuId_districtId_monthStart_key" ON "pricing_trend_monthly"("canonicalSkuId", "districtId", "monthStart");

-- CreateIndex
CREATE INDEX "pricing_alert_evaluation_watchlistId_evaluatedAt_idx" ON "pricing_alert_evaluation"("watchlistId", "evaluatedAt" DESC);

-- CreateIndex
CREATE INDEX "pricing_alert_evaluation_didTrigger_evaluatedAt_idx" ON "pricing_alert_evaluation"("didTrigger", "evaluatedAt" DESC);

-- AddForeignKey
ALTER TABLE "pricing_district" ADD CONSTRAINT "pricing_district_anchorDistrictId_fkey" FOREIGN KEY ("anchorDistrictId") REFERENCES "pricing_district"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_material_category" ADD CONSTRAINT "pricing_material_category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "pricing_material_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_canonical_sku" ADD CONSTRAINT "pricing_canonical_sku_materialCategoryId_fkey" FOREIGN KEY ("materialCategoryId") REFERENCES "pricing_material_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_canonical_sku" ADD CONSTRAINT "pricing_canonical_sku_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "pricing_brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_sku_alias" ADD CONSTRAINT "pricing_sku_alias_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "pricing_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_sku_alias" ADD CONSTRAINT "pricing_sku_alias_canonicalSkuId_fkey" FOREIGN KEY ("canonicalSkuId") REFERENCES "pricing_canonical_sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_unit_conversion" ADD CONSTRAINT "pricing_unit_conversion_materialCategoryId_fkey" FOREIGN KEY ("materialCategoryId") REFERENCES "pricing_material_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_source_endpoint" ADD CONSTRAINT "pricing_source_endpoint_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "pricing_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_source_endpoint" ADD CONSTRAINT "pricing_source_endpoint_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "pricing_district"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_source_endpoint" ADD CONSTRAINT "pricing_source_endpoint_materialCategoryId_fkey" FOREIGN KEY ("materialCategoryId") REFERENCES "pricing_material_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_scrape_run" ADD CONSTRAINT "pricing_scrape_run_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "pricing_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_raw_observation" ADD CONSTRAINT "pricing_raw_observation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pricing_scrape_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_raw_observation" ADD CONSTRAINT "pricing_raw_observation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "pricing_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_observation" ADD CONSTRAINT "pricing_observation_rawId_fkey" FOREIGN KEY ("rawId") REFERENCES "pricing_raw_observation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_observation" ADD CONSTRAINT "pricing_observation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "pricing_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_observation" ADD CONSTRAINT "pricing_observation_canonicalSkuId_fkey" FOREIGN KEY ("canonicalSkuId") REFERENCES "pricing_canonical_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_observation" ADD CONSTRAINT "pricing_observation_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "pricing_district"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_anomaly" ADD CONSTRAINT "pricing_anomaly_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "pricing_observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_district_price_daily" ADD CONSTRAINT "pricing_district_price_daily_canonicalSkuId_fkey" FOREIGN KEY ("canonicalSkuId") REFERENCES "pricing_canonical_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_district_price_daily" ADD CONSTRAINT "pricing_district_price_daily_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "pricing_district"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
