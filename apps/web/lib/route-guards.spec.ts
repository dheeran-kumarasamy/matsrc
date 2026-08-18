import { describe, expect, it } from "vitest";
import { isLegacyDashboardRoute, isProductReportRoute, isProtectedRoute } from "./route-guards";

describe("isProductReportRoute", () => {
  it("matches the per-product price report route", () => {
    expect(isProductReportRoute("/products/abc123/report")).toBe(true);
  });

  it("matches nested sub-paths under the report route", () => {
    expect(isProductReportRoute("/products/abc123/report/market-insight")).toBe(true);
  });

  it("does not match the public product listing page", () => {
    expect(isProductReportRoute("/products")).toBe(false);
  });

  it("does not match the public product detail (PDP) page", () => {
    expect(isProductReportRoute("/products/abc123")).toBe(false);
  });
});

describe("isProtectedRoute", () => {
  it("protects the per-product report route", () => {
    expect(isProtectedRoute("/products/abc123/report")).toBe(true);
  });

  it("does not protect the public catalogue browse route", () => {
    expect(isProtectedRoute("/products")).toBe(false);
  });

  it("does not protect the public product detail page", () => {
    expect(isProtectedRoute("/products/abc123")).toBe(false);
  });

  it("protects the canonical customer dashboard", () => {
    expect(isProtectedRoute("/newdashboard")).toBe(true);
  });

  it("protects the standalone reports explorer", () => {
    expect(isProtectedRoute("/reports")).toBe(true);
    expect(isProtectedRoute("/reports/site-wise")).toBe(true);
  });

  it("does not protect unrelated public routes", () => {
    expect(isProtectedRoute("/")).toBe(false);
    expect(isProtectedRoute("/auth/login")).toBe(false);
  });
});

describe("isLegacyDashboardRoute", () => {
  it("matches the legacy /dashboard path exactly", () => {
    expect(isLegacyDashboardRoute("/dashboard")).toBe(true);
  });

  it("matches nested sub-paths under /dashboard", () => {
    expect(isLegacyDashboardRoute("/dashboard/settings")).toBe(true);
  });

  it("does not match the canonical /newdashboard route", () => {
    expect(isLegacyDashboardRoute("/newdashboard")).toBe(false);
  });

  it("does not match unrelated routes", () => {
    expect(isLegacyDashboardRoute("/products")).toBe(false);
  });
});
