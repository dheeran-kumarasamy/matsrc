 * One-off ad-hoc script: enable a single seeded PricingSourceEndpoint
 * (Agni Steels) with a real Apify actor, then trigger a live ingestion run
 * via the existing PricingIngestionService -- fulfilling the explicit
 * "run a price scraping now" request. This does NOT add any new
 * permanent scheduling; it's a manual, one-time invocation.
 *
 * Runs against the already-compiled dist/ output (produced by
 * `pnpm --filter @matsrc/api build`) so no ts-node/tsx dependency is
 * required -- this repo has neither installed, and installing a new
 * devDependency for a single ad-hoc script isn't warranted.
 *
 * Usage: pnpm --filter @matsrc/api build && node scripts/run-live-scrape.js
 */
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("../dist/app.module");
const { PrismaService } = require("../dist/prisma/prisma.service");
const { PricingIngestionService } = require("../dist/pricing/pricing-ingestion.service");

const ACTOR_ID = "s-r/price-scraper---extract-prices-availability-from-any-url";
const SOURCE_CODE = "AGNI_STEELS";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });

  try {
    const prisma = app.get(PrismaService);
    const ingestion = app.get(PricingIngestionService);

    const source = await prisma.pricingSource.findUnique({ where: { code: SOURCE_CODE } });
    if (!source) {
      throw new Error(`PricingSource "${SOURCE_CODE}" not found -- run seed-pricing.js first.`);
    }

    const endpoint = await prisma.pricingSourceEndpoint.findFirst({ where: { sourceId: source.id } });
    if (!endpoint) {
      throw new Error(`No PricingSourceEndpoint found for source "${SOURCE_CODE}" -- run seed-pricing-endpoints.js first.`);
    }

    console.log(`Enabling source ${SOURCE_CODE} + endpoint ${endpoint.id} for this one-off live run...`);

    await prisma.pricingSource.update({
      where: { id: source.id },
      data: { apifyActorId: ACTOR_ID, isEnabled: true },
    });
    await prisma.pricingSourceEndpoint.update({
      where: { id: endpoint.id },
      data: { isEnabled: true },
    });

    console.log(`Triggering ingestEndpoint(${endpoint.id})...`);
    const result = await ingestion.ingestEndpoint(endpoint.id, "manual:ad-hoc-scrape-request");

    console.log("Ingestion result:", result);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error("run-live-scrape failed:", err);
  process.exitCode = 1;
});
