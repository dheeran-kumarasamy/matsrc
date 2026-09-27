import { describe, expect, it, vi } from "vitest";
import {
  formatEnquiryId,
  resolveBuilderCode,
  resolveSiteCode,
  nextEnquirySequence,
  generateEnquiryId,
} from "@matsrc/db";

/**
 * Unit tests for the Meaningful Enquiry ID generator
 * (packages/db/lib/enquiry-id.ts). Uses a minimal in-memory fake
 * transaction client (mirroring the existing fake-Prisma pattern used in
 * apps/api/src/aggregation/aggregation.service.spec.ts) so the row-locked
 * sequence/collision logic is exercised close to real behaviour without a
 * real database.
 */
function createFakeTx() {
  const users = new Map<string, { id: string; builderCode?: string | null }>();
  const sites = new Map<string, { id: string; code?: string | null }>();
  let sequenceValue = 0;

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const user = where.id ? users.get(where.id) : [...users.values()].find((u) => u.builderCode === where.builderCode);
        if (!user) return null;
        if (select?.builderCode) return { builderCode: user.builderCode ?? null };
        return user;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const user = users.get(where.id);
        if (!user) throw new Error("user not found");
        Object.assign(user, data);
        return { builderCode: user.builderCode };
      }),
    },
    site: {
      findUnique: vi.fn(async ({ where }: any) => {
        const site = sites.get(where.id);
        return site ? { code: site.code ?? null } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const site = sites.get(where.id);
        if (!site) throw new Error("site not found");
        Object.assign(site, data);
        return site;
      }),
    },
    enquirySequence: {
      update: vi.fn(async () => {
        sequenceValue += 1;
        return { value: sequenceValue };
      }),
    },
  };

  return {
    tx,
    seedUser: (id: string, builderCode?: string | null) => users.set(id, { id, builderCode }),
    seedSite: (id: string, code?: string | null) => sites.set(id, { id, code }),
  };
}

describe("formatEnquiryId", () => {
  it("formats CONTRACTOR-SITE-SEQUENCE with a 6-digit zero-padded sequence", () => {
    expect(formatEnquiryId("ABC", "SITE01", 123)).toBe("ABC-SITE01-000123");
  });

  it("zero-pads small sequence numbers", () => {
    expect(formatEnquiryId("XYZ", "S01", 1)).toBe("XYZ-S01-000001");
  });
});

describe("resolveBuilderCode", () => {
  it("returns the existing builderCode unchanged if already set", async () => {
    const { tx, seedUser } = createFakeTx();
    seedUser("builder-1", "ABC");

    const code = await resolveBuilderCode(tx as any, "builder-1", "New Display Name", "email@example.com");
    expect(code).toBe("ABC");
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("derives and persists a new code from the builder name on first use", async () => {
    const { tx, seedUser } = createFakeTx();
    seedUser("builder-1", null);

    const code = await resolveBuilderCode(tx as any, "builder-1", "Acme Builders", "acme@example.com");
    expect(code).toBe("ACM");
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "builder-1" }, data: { builderCode: "ACM" } })
    );
  });

  it("falls back to the email local-part when name is missing", async () => {
    const { tx, seedUser } = createFakeTx();
    seedUser("builder-2", null);

    const code = await resolveBuilderCode(tx as any, "builder-2", null, "zenith@example.com");
    expect(code).toBe("ZEN");
  });
});

describe("resolveSiteCode", () => {
  it("normalizes and returns an existing site code", async () => {
    const { tx, seedSite } = createFakeTx();
    seedSite("site-1", "site 01");

    const code = await resolveSiteCode(tx as any, "site-1");
    expect(code).toBe("SITE01");
  });

  it("derives and persists a fallback code from the site id when code is missing", async () => {
    const { tx, seedSite } = createFakeTx();
    seedSite("site-2", null);

    const code = await resolveSiteCode(tx as any, "site-2");
    expect(code).toMatch(/^SITE/);
    expect(tx.site.update).toHaveBeenCalled();
  });
});

describe("nextEnquirySequence", () => {
  it("increments monotonically across repeated calls", async () => {
    const { tx } = createFakeTx();

    const first = await nextEnquirySequence(tx as any);
    const second = await nextEnquirySequence(tx as any);
    const third = await nextEnquirySequence(tx as any);

    expect([first, second, third]).toEqual([1, 2, 3]);
  });

  it("takes a row lock via $queryRaw before incrementing", async () => {
    const { tx } = createFakeTx();
    await nextEnquirySequence(tx as any);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
});

describe("generateEnquiryId", () => {
  it("produces the full CONTRACTOR-SITE-SEQUENCE id for a new builder/site", async () => {
    const { tx, seedUser, seedSite } = createFakeTx();
    seedUser("builder-1", null);
    seedSite("site-1", "SITE01");

    const id = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Acme Builders",
      builderEmail: "acme@example.com",
      siteId: "site-1",
    });

    expect(id).toBe("ACM-SITE01-000001");
  });

  it("falls back to UNSITED when no siteId is provided", async () => {
    const { tx, seedUser } = createFakeTx();
    seedUser("builder-1", "ABC");

    const id = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Acme",
      builderEmail: "acme@example.com",
      siteId: null,
    });

    expect(id).toBe("ABC-UNSITED-000001");
  });

  it("reuses the same contractor code across multiple enquiries for the same builder", async () => {
    const { tx, seedUser, seedSite } = createFakeTx();
    seedUser("builder-1", null);
    seedSite("site-1", "SITE01");
    seedSite("site-2", "SITE02");

    const first = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Acme Builders",
      builderEmail: "acme@example.com",
      siteId: "site-1",
    });
    const second = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Acme Builders",
      builderEmail: "acme@example.com",
      siteId: "site-2",
    });

    expect(first).toBe("ACM-SITE01-000001");
    expect(second).toBe("ACM-SITE02-000002");
  });

  it("keeps the numeric sequence globally increasing across different builders/sites", async () => {
    const { tx, seedUser, seedSite } = createFakeTx();
    seedUser("builder-1", "ABC");
    seedUser("builder-2", "XYZ");
    seedSite("site-1", "S01");

    const first = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Builder One",
      builderEmail: "one@example.com",
      siteId: "site-1",
    });
    const second = await generateEnquiryId(tx as any, {
      builderId: "builder-2",
      builderName: "Builder Two",
      builderEmail: "two@example.com",
      siteId: "site-1",
    });

    expect(first).toBe("ABC-S01-000001");
    expect(second).toBe("XYZ-S01-000002");
  });
});
