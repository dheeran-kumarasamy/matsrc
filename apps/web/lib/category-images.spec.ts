import { describe, it, expect } from "vitest";
import { getProductImage, getCategoryEmoji } from "./category-images";

const FORBIDDEN_404_URLS = [
  "photo-1621905252472-e8de3d47fea8",
  "photo-1610500795312-4a5b6b2b6e2f",
  "photo-1567605532317-c8a3b1c25f5a",
];

describe("category-images engine", () => {
  it("resolves brand fallback image for Supreme/Astral pipes without 404 URL", () => {
    const url = getProductImage({ category: "Plumbing", name: "Supreme PVC Pipes" });
    expect(url).toContain("photo-1585704032915-c3400ca199e7");
    for (const bad of FORBIDDEN_404_URLS) {
      expect(url).not.toContain(bad);
    }
  });

  it("resolves category fallback image for Aggregate / Sand without 404 URL", () => {
    const url = getProductImage({ category: "Aggregate 20mm" });
    expect(url).toContain("photo-1578885136359-16c8bd4d3a8e");
    for (const bad of FORBIDDEN_404_URLS) {
      expect(url).not.toContain(bad);
    }
  });

  it("resolves category fallback image for Brick / AAC blocks without 404 URL", () => {
    const url = getProductImage({ category: "Red Bricks" });
    expect(url).toContain("photo-1552666792-fff5d9eee6ac");
    for (const bad of FORBIDDEN_404_URLS) {
      expect(url).not.toContain(bad);
    }
  });

  it("resolves brand-first over category", () => {
    const url = getProductImage({ category: "TMT Bars", brand: "Tata Tiscon", name: "550D" });
    expect(url).toContain("photo-1581092160607-ee22621dd758");
  });

  it("resolves cement brands correctly", () => {
    const ambuja = getProductImage({ category: "Cement", brand: "Ambuja", name: "PPC" });
    expect(ambuja).toContain("photo-1621905251189-08b45d6a269e");

    const ultratech = getProductImage({ category: "Cement", brand: "UltraTech", name: "Super" });
    expect(ultratech).toContain("photo-1600585152220-90363fe7e115");

    const acc = getProductImage({ category: "Cement", brand: "ACC", name: "Suraksha" });
    expect(acc).toContain("photo-1590247813693-5541d1c609fd");
  });

  it("falls back to generic default image for unknown brand and category", () => {
    const generic = getProductImage({ category: "Unknown Space Material", brand: "Alien Brand" });
    expect(generic).toBe(
      "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=600&q=60"
    );
  });

  it("resolves category emojis correctly", () => {
    expect(getCategoryEmoji("Steel")).toBe("🔩");
    expect(getCategoryEmoji("Cement")).toBe("🏗️");
    expect(getCategoryEmoji("Brick")).toBe("🧱");
    expect(getCategoryEmoji("Sand")).toBe("⛏️");
    expect(getCategoryEmoji("Unknown")).toBe("📦");
  });
});
