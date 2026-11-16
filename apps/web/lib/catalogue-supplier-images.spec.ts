import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const productsPageSource = readFileSync(
  path.resolve(__dirname, "../app/(builder)/products/page.tsx"),
  "utf-8"
);

describe("Catalogue supplier images display (PLP regression guard)", () => {
  it("does not strip data URIs or base64 images when preparing cardProducts", () => {
    // Regression guard: the old implementation stripped data: URIs and any image > 1024 chars:
    //   if (cardImage && typeof cardImage === "string" && (cardImage.startsWith("data:") || cardImage.length > 1024))
    // This prevented supplier-uploaded photos (which are stored as base64 data URIs)
    // from rendering on the /products catalogue cards.
    expect(productsPageSource).not.toMatch(/cardImage\.startsWith\("data:"\)/);
    expect(productsPageSource).not.toMatch(/cardImage\.length > 1024/);
  });

  it("uses the uploaded listing image when present, falling back to category image only when missing", () => {
    expect(productsPageSource).toMatch(
      /let cardImage = listing\.images && listing\.images\.length > 0 \? listing\.images\[0\] : undefined;/
    );
    expect(productsPageSource).toMatch(/if \(!cardImage\) \{/);
  });
});

