import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

// C18 regression guard: cart items must link to the canonical Product
// Detail route using the product's existing id (item.productId), reusing
// the same /products/[id] route ProductCard/ProductQuickView already link
// to — no new/duplicate route. Source-based guard following the same
// pattern as lib/product-card-price-render.spec.ts (no jsdom/testing-library
// harness configured in this repo).
const cartDrawerSource = readFileSync(
  path.resolve(__dirname, "../components/cart/CartDrawer.tsx"),
  "utf-8"
);

describe("CartDrawer — C18 product navigation (source regression guard)", () => {
  it("links the product image to the canonical Product Detail route using item.productId", () => {
    expect(cartDrawerSource).toMatch(/href=\{`\/products\/\$\{item\.productId\}`\}/);
  });

  it("does not introduce a second/duplicate product route", () => {
    const matches = cartDrawerSource.match(/\/products\/\$\{item\.productId\}/g) ?? [];
    // Image link + name link = exactly 2 usages of the same canonical route.
    expect(matches.length).toBe(2);
  });

  it("still preserves the C12 image rendering (item.image) inside the new link", () => {
    expect(cartDrawerSource).toMatch(/item\.image/);
  });
});
