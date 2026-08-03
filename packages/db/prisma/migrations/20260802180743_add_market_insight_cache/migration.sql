-- CreateTable
CREATE TABLE "MarketInsightCache" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "driversJson" JSONB NOT NULL,
    "outlook" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketInsightCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketInsightCache_expiresAt_idx" ON "MarketInsightCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketInsightCache_category_region_key" ON "MarketInsightCache"("category", "region");
