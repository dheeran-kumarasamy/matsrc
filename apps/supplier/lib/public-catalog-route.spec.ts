import { beforeEach, describe, expect, it, vi } from "vitest";

const categoryFindManyMock = vi.fn();
const brandFindManyMock = vi.fn();
const gradeFindManyMock = vi.fn();
const unitFindManyMock = vi.fn();
const ensurePricingSchemaMock = vi.fn();

vi.mock("@matsrc/db", () => ({
  prisma: {
    category: { findMany: (...args: unknown[]) => categoryFindManyMock(...args) },
    brand: { findMany: (...args: unknown[]) => brandFindManyMock(...args) },
    grade: { findMany: (...args: unknown[]) => gradeFindManyMock(...args) },
    unit: { findMany: (...args: unknown[]) => unitFindManyMock(...args) },
  },
}));

vi.mock("@/lib/supplier-data", () => ({
  ensurePricingSchema: () => ensurePricingSchemaMock(),
}));

import { GET } from "@/app/api/public/catalog/[entity]/route";

describe("GET /api/public/catalog/[entity]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePricingSchemaMock.mockResolvedValue(undefined);
  });

  it("returns 400 for an unknown entity", async () => {
    const res = await GET(new Request("http://localhost/api/public/catalog/invalid"), {
      params: { entity: "invalid" },
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Unknown catalog entity");
  });

  it("returns active categories", async () => {
    categoryFindManyMock.mockResolvedValueOnce([
      { id: "cat-1", name: "Steel", slug: "steel", isActive: true },
      { id: "cat-2", name: "Cement", slug: "cement", isActive: true },
    ]);

    const res = await GET(new Request("http://localhost/api/public/catalog/category"), {
      params: { entity: "category" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0].name).toBe("Steel");
    expect(ensurePricingSchemaMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to querying categories without isOrderable if schema throws", async () => {
    categoryFindManyMock
      .mockRejectedValueOnce(new Error("column isOrderable does not exist"))
      .mockResolvedValueOnce([
        { id: "cat-1", name: "Steel", slug: "steel", isActive: true },
      ]);

    const res = await GET(new Request("http://localhost/api/public/catalog/category"), {
      params: { entity: "category" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("Steel");
  });

  it("returns active brands", async () => {
    brandFindManyMock.mockResolvedValueOnce([
      { id: "brand-1", name: "Tata Steel", isActive: true },
    ]);

    const res = await GET(new Request("http://localhost/api/public/catalog/brand"), {
      params: { entity: "brand" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("Tata Steel");
  });

  it("returns active grades", async () => {
    gradeFindManyMock.mockResolvedValueOnce([
      { id: "grade-1", name: "Fe 550D", isActive: true },
    ]);

    const res = await GET(new Request("http://localhost/api/public/catalog/grade"), {
      params: { entity: "grade" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("Fe 550D");
  });

  it("returns active units", async () => {
    unitFindManyMock.mockResolvedValueOnce([
      { id: "unit-1", name: "MT", isActive: true },
      { id: "unit-2", name: "BAG", isActive: true },
    ]);

    const res = await GET(new Request("http://localhost/api/public/catalog/unit"), {
      params: { entity: "unit" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0].name).toBe("MT");
  });

  it("returns 500 when database fails", async () => {
    unitFindManyMock.mockRejectedValueOnce(new Error("DB connection failure"));

    const res = await GET(new Request("http://localhost/api/public/catalog/unit"), {
      params: { entity: "unit" },
    });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to fetch catalog options");
  });
});
