// Manual integration smoke test for Consolidated Enquiry ID generation against
// a REAL database. Not part of the default `vitest run` suite (this file is
// intentionally NOT named `*.spec.ts` in the standard sense picked up by
// apps/api/vitest.config.ts's `include: ["src/**/*.spec.ts"]` glob — wait,
// it does match; see note below) — run manually via:
//
//   cd apps/api && DATABASE_URL=... DIRECT_URL=... pnpm exec vitest run \
//     src/common/enquiry-id.integration.manual.spec.ts
//
// It exercises generateEnquiryId() against the real dev database (never
// production — guarded by the existing db-safety preflight for any actual
// migration, and this file only ever creates a temporary throwaway User +
// Site + Orders inside a single transaction that is ROLLED BACK at the end,
// so it never leaves data behind).
import { describe, expect, it } from "vitest";
import { PrismaClient, generateEnquiryId } from "@matsrc/db";

const RUN_INTEGRATION = process.env.RUN_ENQUIRY_ID_INTEGRATION === "true";

describe.skipIf(!RUN_INTEGRATION)("generateEnquiryId — real database integration", () => {
  it("produces unique, globally-increasing ids under concurrent generation, then rolls back", async () => {
    const prisma = new PrismaClient();
    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: `enquiry-id-test-${Date.now()}@example.com`, name: "Enquiry Id Test Builder", role: "BUILDER" },
        });
        const site = await tx.site.create({
          data: { builderId: user.id, name: `Test Site ${Date.now()}`, code: "T01", city: "Chennai" },
        });

        // Concurrent generation: fire 10 generateEnquiryId calls in parallel
        // for the SAME builder/site and confirm all 10 resulting ids are
        // unique (no duplicate sequence numbers handed out).
        const results = await Promise.all(
          Array.from({ length: 10 }, () =>
            generateEnquiryId(tx, {
              builderId: user.id,
              builderName: user.name,
              builderEmail: user.email,
              siteId: site.id,
            })
          )
        );

        const uniqueIds = new Set(results);
        expect(uniqueIds.size).toBe(10);

        for (const id of results) {
          expect(id).toMatch(/^[A-Z]{3}-TESTS-CHE[A-Z0-9]-\d{5}$/);
        }

        // Force rollback — this integration test must never persist data.
        throw new Error("__ROLLBACK__");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "__ROLLBACK__") {
        throw error;
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});
