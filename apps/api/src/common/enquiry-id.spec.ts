import { describe, expect, it, vi } from "vitest";
import {
  formatEnquiryId,
  resolveFirstNameCode,
  resolveSiteNameCode,
  resolveCityCode,
  generateRandomAlphanumericChar,
  generateCityRandomComponent,
  nextEnquirySequence,
  generateEnquiryId,
} from "@matsrc/db";

/**
 * Unit tests for the Consolidated Enquiry ID generator
 * (packages/db/lib/enquiry-id.ts). Uses a minimal in-memory fake
 * transaction client (mirroring the existing fake-Prisma pattern used in
 * apps/api/src/aggregation/aggregation.service.spec.ts) so the row-locked
 * serial logic is exercised close to real behaviour without a real
 * database.
 */
function createFakeTx() {
  const sites = new Map<string, { id: string; name?: string | null; city?: string | null }>();
  let sequenceValue = 0;

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    site: {
      findUnique: vi.fn(async ({ where }: any) => {
        const site = sites.get(where.id);
        return site ? { name: site.name ?? null, city: site.city ?? null } : null;
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
    seedSite: (id: string, name?: string | null, city?: string | null) => sites.set(id, { id, name, city }),
  };
}

describe("formatEnquiryId", () => {
  it("formats FIRSTNAME-SITENAME-CITYRANDOM-SERIAL with a 5-digit zero-padded serial", () => {
    expect(formatEnquiryId("RAJ", "CHENN", "CHE7", 123)).toBe("RAJ-CHENN-CHE7-00123");
  });

  it("zero-pads small serial numbers", () => {
    expect(formatEnquiryId("XYZ", "ERODE", "ERO4", 1)).toBe("XYZ-ERODE-ERO4-00001");
  });

  it("supports the maximum 5-digit serial", () => {
    expect(formatEnquiryId("ARB", "MADUR", "MAD9", 99999)).toBe("ARB-MADUR-MAD9-99999");
  });
});

describe("resolveFirstNameCode", () => {
  it("takes the first 3 uppercase letters of the builder's first name", () => {
    expect(resolveFirstNameCode("Rajesh", "rajesh@example.com", "builder-1")).toBe("RAJ");
    expect(resolveFirstNameCode("Kumar", null, "builder-1")).toBe("KUM");
    expect(resolveFirstNameCode("Arun", null, "builder-1")).toBe("ARU");
    expect(resolveFirstNameCode("Christopher", null, "builder-1")).toBe("CHR");
  });

  it("falls back to the email local-part when name is absent", () => {
    expect(resolveFirstNameCode(null, "zenith@example.com", "builder-1")).toBe("ZEN");
  });

  it("deterministically pads using the builder id when fewer than 3 letters are available", () => {
    const code = resolveFirstNameCode("A", null, "builder-42");
    expect(code).toHaveLength(3);
    expect(code.startsWith("A")).toBe(true);
  });
});

describe("resolveSiteNameCode", () => {
  it("takes the first 5 uppercase alphanumeric characters of the site name", () => {
    expect(resolveSiteNameCode("Chennai Site", "site-1")).toBe("CHENN");
    expect(resolveSiteNameCode("Erode Project", "site-2")).toBe("ERODE");
    expect(resolveSiteNameCode("Madurai Site", "site-3")).toBe("MADUR");
    expect(resolveSiteNameCode("Chennai Phase 2", "site-4")).toBe("CHENN");
  });

  it("deterministically pads using the site seed when fewer than 5 characters are available", () => {
    const code = resolveSiteNameCode("AB", "site-99");
    expect(code).toHaveLength(5);
    expect(code.startsWith("AB")).toBe(true);
  });
});

describe("resolveCityCode", () => {
  it("takes the first 3 uppercase letters of the city", () => {
    expect(resolveCityCode("Chennai")).toBe("CHE");
    expect(resolveCityCode("Madurai")).toBe("MAD");
    expect(resolveCityCode("Erode")).toBe("ERO");
    expect(resolveCityCode("Coimbatore")).toBe("COI");
    expect(resolveCityCode("Salem")).toBe("SAL");
  });

  it("returns null when the city is missing or too short", () => {
    expect(resolveCityCode(null)).toBeNull();
    expect(resolveCityCode(undefined)).toBeNull();
    expect(resolveCityCode("")).toBeNull();
    expect(resolveCityCode("Al")).toBeNull();
  });
});

describe("generateRandomAlphanumericChar", () => {
  it("always returns a single uppercase alphanumeric character", () => {
    for (let i = 0; i < 50; i += 1) {
      const char = generateRandomAlphanumericChar();
      expect(char).toMatch(/^[A-Z0-9]$/);
    }
  });
});

describe("generateCityRandomComponent", () => {
  it("returns CITY3 + a random character when a city is present", () => {
    const component = generateCityRandomComponent("Chennai");
    expect(component).toHaveLength(4);
    expect(component.slice(0, 3)).toBe("CHE");
    expect(component[3]).toMatch(/^[A-Z0-9]$/);
  });

  it("returns a fully random 4-character value when no city is present", () => {
    const component = generateCityRandomComponent(null);
    expect(component).toMatch(/^[A-Z0-9]{4}$/);
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
  it("produces the full FIRSTNAME-SITENAME-CITYRANDOM-SERIAL id for a new builder/site", async () => {
    const { tx, seedSite } = createFakeTx();
    seedSite("site-1", "Chennai Site", "Chennai");

    const id = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Rajesh",
      builderEmail: "rajesh@example.com",
      siteId: "site-1",
    });

    expect(id).toMatch(/^RAJ-CHENN-CHE[A-Z0-9]-00001$/);
  });

  it("falls back to a deterministic UNSITED-derived site code and fully random 4-char component when no siteId is provided", async () => {
    const { tx } = createFakeTx();

    const id = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Acme",
      builderEmail: "acme@example.com",
      siteId: null,
    });

    expect(id).toMatch(/^ACM-UNSIT-[A-Z0-9]{4}-00001$/);
  });

  it("uses a fully random 4-character third component when the selected site has no city", async () => {
    const { tx, seedSite } = createFakeTx();
    seedSite("site-1", "Erode Project", null);

    const id = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Kumar",
      builderEmail: "kumar@example.com",
      siteId: "site-1",
    });

    expect(id).toMatch(/^KUM-ERODE-[A-Z0-9]{4}-00001$/);
  });

  it("uses the actual selected site, not any other site", async () => {
    const { tx, seedSite } = createFakeTx();
    seedSite("site-1", "Erode Project", "Erode");
    seedSite("site-2", "Chennai Site", "Chennai");

    const first = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Rajesh",
      builderEmail: "rajesh@example.com",
      siteId: "site-1",
    });
    const second = await generateEnquiryId(tx as any, {
      builderId: "builder-1",
      builderName: "Rajesh",
      builderEmail: "rajesh@example.com",
      siteId: "site-2",
    });

    expect(first).toMatch(/^RAJ-ERODE-ERO[A-Z0-9]-00001$/);
    expect(second).toMatch(/^RAJ-CHENN-CHE[A-Z0-9]-00002$/);
  });

  it("keeps the numeric serial globally increasing across different builders/sites", async () => {
    const { tx, seedSite } = createFakeTx();
    seedSite("site-1", "Site One", "Salem");

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

    expect(first.endsWith("-00001")).toBe(true);
    expect(second.endsWith("-00002")).toBe(true);
  });

  it("produces unique complete ids across multiple enquiries", async () => {
    const { tx, seedSite } = createFakeTx();
    seedSite("site-1", "Chennai Site", "Chennai");

    const ids = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      ids.add(
        await generateEnquiryId(tx as any, {
          builderId: "builder-1",
          builderName: "Rajesh",
          builderEmail: "rajesh@example.com",
          siteId: "site-1",
        })
      );
    }

    expect(ids.size).toBe(10);
  });
});
