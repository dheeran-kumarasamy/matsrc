// breadcrumbs.spec.ts — P2-C (Breadcrumbs) + P2-D (Breadcrumb JSON-LD).
import { describe, expect, it } from "vitest";
import {
  catalogueBreadcrumbs,
  categoryBreadcrumbs,
  productBreadcrumbs,
  productReportBreadcrumbs,
} from "./breadcrumbs";

describe("catalogueBreadcrumbs", () => {
  it("returns Home -> Materials, with Materials as the current (non-linked) page", () => {
    const crumbs = catalogueBreadcrumbs();
    expect(crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "Materials", href: null },
    ]);
  });
});

describe("categoryBreadcrumbs", () => {
  it("returns Home -> Materials -> <Category>, with Category as current", () => {
    const crumbs = categoryBreadcrumbs("Cement");
    expect(crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "Materials", href: "/products" },
      { label: "Cement", href: null },
    ]);
  });
});

describe("productBreadcrumbs", () => {
  it("includes a real category crumb when the product has one", () => {
    const crumbs = productBreadcrumbs({ categoryName: "Cement", productName: "UltraTech OPC 53" });
    expect(crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "Materials", href: "/products" },
      { label: "Cement", href: "/products?category=Cement" },
      { label: "UltraTech OPC 53", href: null },
    ]);
  });

  it("omits the category crumb entirely when the product has no category, never inventing one", () => {
    const crumbs = productBreadcrumbs({ categoryName: null, productName: "Mystery Item" });
    expect(crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "Materials", href: "/products" },
      { label: "Mystery Item", href: null },
    ]);
  });

  it("URL-encodes the category name in its link", () => {
    const crumbs = productBreadcrumbs({ categoryName: "Sand & Aggregates", productName: "River Sand" });
    expect(crumbs[2].href).toBe("/products?category=Sand%20%26%20Aggregates");
  });
});

describe("productReportBreadcrumbs", () => {
  it("links the product crumb (since Report is now the leaf) and appends a Price Report leaf", () => {
    const crumbs = productReportBreadcrumbs({
      categoryName: "Cement",
      productName: "UltraTech OPC 53",
      productSlug: "cmrn7uy6n0001va66ncrw45k2",
    });
    expect(crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "Materials", href: "/products" },
      { label: "Cement", href: "/products?category=Cement" },
      { label: "UltraTech OPC 53", href: "/products/cmrn7uy6n0001va66ncrw45k2" },
      { label: "Price Report", href: null },
    ]);
  });

  it("uses the same category-crumb logic as productBreadcrumbs (single source of truth)", () => {
    const productCrumbs = productBreadcrumbs({ categoryName: "TMT Bars", productName: "X" });
    const reportCrumbs = productReportBreadcrumbs({ categoryName: "TMT Bars", productName: "X", productSlug: "x" });
    expect(reportCrumbs[2]).toEqual(productCrumbs[2]);
  });
});
