-- CreateEnum
CREATE TYPE "SourcingSessionStatus" AS ENUM ('COLLECTING', 'SEARCHING', 'RECOMMENDED', 'CONFIRMED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SourcingApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SourcingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT,
    "status" "SourcingSessionStatus" NOT NULL DEFAULT 'COLLECTING',
    "requirementJson" JSONB,
    "conversationJson" JSONB,
    "candidateProductsJson" JSONB,
    "candidateSuppliersJson" JSONB,
    "confirmedRecommendationId" TEXT,
    "confirmedOrderId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingRecommendation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT,
    "rank" INTEGER NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT,
    "unitMaterialPrice" DECIMAL(12,2),
    "materialCost" DECIMAL(14,2),
    "freightCost" DECIMAL(14,2),
    "deliveryCharges" DECIMAL(14,2),
    "handlingCharges" DECIMAL(14,2),
    "taxAmount" DECIMAL(14,2),
    "estimatedLandedCost" DECIMAL(14,2),
    "unitLandedCost" DECIMAL(14,4),
    "deliveryDays" INTEGER,
    "reliabilityScore" DECIMAL(5,2),
    "specificationMatch" BOOLEAN NOT NULL DEFAULT false,
    "reasonsJson" JSONB NOT NULL,
    "dataGapsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingToolInvocation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "inputJson" JSONB,
    "resultSummaryJson" JSONB,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "approvalStatus" "SourcingApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingToolInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcingSession_userId_idx" ON "SourcingSession"("userId");

-- CreateIndex
CREATE INDEX "SourcingSession_userId_status_idx" ON "SourcingSession"("userId", "status");

-- CreateIndex
CREATE INDEX "SourcingSession_userId_updatedAt_idx" ON "SourcingSession"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "SourcingSession_siteId_idx" ON "SourcingSession"("siteId");

-- CreateIndex
CREATE INDEX "SourcingRecommendation_sessionId_idx" ON "SourcingRecommendation"("sessionId");

-- CreateIndex
CREATE INDEX "SourcingRecommendation_supplierId_idx" ON "SourcingRecommendation"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SourcingRecommendation_sessionId_rank_key" ON "SourcingRecommendation"("sessionId", "rank");

-- CreateIndex
CREATE INDEX "SourcingToolInvocation_sessionId_createdAt_idx" ON "SourcingToolInvocation"("sessionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SourcingToolInvocation_userId_createdAt_idx" ON "SourcingToolInvocation"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SourcingToolInvocation_tool_idx" ON "SourcingToolInvocation"("tool");

-- AddForeignKey
ALTER TABLE "SourcingSession" ADD CONSTRAINT "SourcingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingSession" ADD CONSTRAINT "SourcingSession_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingRecommendation" ADD CONSTRAINT "SourcingRecommendation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SourcingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingRecommendation" ADD CONSTRAINT "SourcingRecommendation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingRecommendation" ADD CONSTRAINT "SourcingRecommendation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingToolInvocation" ADD CONSTRAINT "SourcingToolInvocation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SourcingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

