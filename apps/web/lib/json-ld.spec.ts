// json-ld.spec.ts — P2-D (SEO metadata / structured data).
import { describe, expect, it } from "vitest";
import { buildProductJsonLd, buildBreadcrumbJsonLd } from "./json-ld";
import { productBreadcrumbs } from "./breadcrumbs";

describe("buildProductJsonLd", () => {
  it("includes only genuinely provided fields", () => {
    const jsonLd = buildProductJsonLd({
      name: "UltraTech OPC 53 Grade",
      description: "High strength cement",
      image: "https://example.com/img.jpg",
      brand: "UltraTech Cement",
      category: "Cement",
      sku: "cmrn7uy6n0001va66ncrw45k2",
    });

    expect(jsonLd["@type"]).toBe("Product");
    expect(jsonLd.name).toBe("UltraTech OPC 53 Grade");
    expect(jsonLd.brand).toEqual({ "@type": "Brand", name: "UltraTech Cement" });
    expect(jsonLd.sku).toBe("cmrn7uy6n0001va66ncrw45k2");
  });

  it("never includes offers or aggregateRating fields", () => {
    const jsonLd = buildProductJsonLd({
      name: "Some Product",
      sku: "abc123",
    });

    expect(jsonLd).not.toHaveProperty("offers");
    expect(jsonLd).not.toHaveProperty("aggregateRating");
    expect(jsonLd).not.toHaveProperty("review");
  });

  it("omits optional fields entirely when not provided, rather than fabricating placeholders", () => {
    const jsonLd = buildProductJsonLd({ name: "Bare Product", sku: "xyz" });
    expect(jsonLd).not.toHaveProperty("description");
    expect(jsonLd).not.toHaveProperty("image");
    expect(jsonLd).not.toHaveProperty("brand");
    expect(jsonLd).not.toHaveProperty("category");
  });
});

describe("buildBreadcrumbJsonLd", () => {
  it("matches the same hierarchy the UI breadcrumbs use (single source of truth)", () => {
    const uiCrumbs = productBreadcrumbs({ categoryName: "Cement", productName: "UltraTech OPC 53" });
    const jsonLd = buildBreadcrumbJsonLd(uiCrumbs);

    expect(jsonLd["@type"]).toBe("BreadcrumbList");
    const items = jsonLd.itemListElement as any[];
    expect(items).toHaveLength(4);
    expect(items[0].name).toBe("Home");
    expect(items[3].name).toBe("UltraTech OPC 53");
  });

  it("gives every linked crumb an absolute item URL", () => {
    const uiCrumbs = productBreadcrumbs({ categoryName: "Cement", productName: "X" });
    const jsonLd = buildBreadcrumbJsonLd(uiCrumbs);
    const items = jsonLd.itemListElement as any[];
    expect(items[0].item).toMatch(/^https?:\/\//);
    expect(items[1].item).toMatch(/\/products$/);
  });

  it("omits the item URL for the current/terminal (non-linked) crumb", () => {
    const uiCrumbs = productBreadcrumbs({ categoryName: "Cement", productName: "X" });
    const jsonLd = buildBreadcrumbJsonLd(uiCrumbs);
    const items = jsonLd.itemListElement as any[];
    expect(items[items.length - 1].item).toBeUndefined();
  });
});
