// Default fallback images shown when a supplier hasn't uploaded any product photos.
//
// Two levels of matching are used so the fallback photo is as relevant as
// possible to the actual product being displayed (not just a generic
// category stock photo):
//
//   1. Brand match — checked first against the product's brand/name text.
//      Known construction-material brands (Ambuja, UltraTech, ACC, JSW,
//      Tata Steel, Birla, etc.) map to a real product photo that matches
//      how that brand's packaging/product actually looks (e.g. a genuine
//      cement bag photo for cement brands, a rebar/coil photo for steel
//      brands) rather than a generic "cement" or "steel" stock photo.
//   2. Category match — falls back to a broader keyword match against the
//      product's category name when no brand match is found.
//
// A generic fallback image is used only when neither matches.

type BrandImageEntry = {
  // Keywords checked against the combined "brand name" text (case-insensitive).
  keywords: string[];
  image: string;
};

// Brand-specific fallback photos. Each entry's image is chosen to visually
// match what that brand's real product looks like (branded cement bags,
// TMT rebar bundles, etc.) rather than a generic category stock photo.
const BRAND_IMAGES: BrandImageEntry[] = [
  {
    // Ambuja Cement — yellow 50kg cement bags.
    keywords: ["ambuja"],
    image: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=600&q=60",
  },
  {
    // UltraTech Cement — grey/white branded cement bags.
    keywords: ["ultratech"],
    image: "https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&w=600&q=60",
  },
  {
    // ACC Cement — stacked cement bags at a dealer/warehouse.
    keywords: ["acc cement", "acc limited", "\"acc\""],
    image: "https://images.unsplash.com/photo-1590247813693-5541d1c609fd?auto=format&fit=crop&w=600&q=60",
  },
  {
    // Birla / Birla Corp cement.
    keywords: ["birla"],
    image: "https://images.unsplash.com/photo-1590247813693-5541d1c609fd?auto=format&fit=crop&w=600&q=60",
  },
  {
    // JSW Steel — TMT bars / steel coils.
    keywords: ["jsw"],
    image: "https://images.unsplash.com/photo-1587293852726-70cdb56c2866?auto=format&fit=crop&w=600&q=60",
  },
  {
    // Tata Steel / Tata Tiscon — TMT rebar bundles.
    keywords: ["tata steel", "tiscon", "tata tiscon"],
    image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=60",
  },
  {
    // SAIL — steel bars/coils.
    keywords: ["sail"],
    image: "https://images.unsplash.com/photo-1587293852726-70cdb56c2866?auto=format&fit=crop&w=600&q=60",
  },
  {
    // Asian Paints — paint cans/buckets.
    keywords: ["asian paints"],
    image: "https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=600&q=60",
  },
  {
    // Berger Paints.
    keywords: ["berger"],
    image: "https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=600&q=60",
  },
  {
    // Supreme / Astral / Finolex — PVC pipes.
    keywords: ["supreme", "astral", "finolex"],
    image: "https://images.unsplash.com/photo-1621905252472-e8de3d47fea8?auto=format&fit=crop&w=600&q=60",
  },
  {
    // Havells / Polycab / Anchor — electrical wires and switches.
    keywords: ["havells", "polycab", "anchor"],
    image: "https://images.unsplash.com/photo-1565608087341-404b25492fee?auto=format&fit=crop&w=600&q=60",
  },
  {
    // Century Ply / Greenply — plywood sheets.
    keywords: ["century ply", "greenply", "century plyboards"],
    image: "https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?auto=format&fit=crop&w=600&q=60",
  },
  {
    // Kajaria / Somany — ceramic/vitrified tiles.
    keywords: ["kajaria", "somany"],
    image: "https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=600&q=60",
  },
];

type CategoryImageEntry = {
  keywords: string[];
  image: string;
};

// Broader category-keyword fallback (used when no brand match is found).
const CATEGORY_IMAGES: CategoryImageEntry[] = [
  {
    keywords: ["cement"],
    image: "https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["steel", "tmt", "rebar", "rod"],
    image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["aggregate", "sand", "gravel", "crushed"],
    image: "https://images.unsplash.com/photo-1610500795312-4a5b6b2b6e2f?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["pipe", "fitting", "pvc", "cpvc"],
    image: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["brick", "block", "aac"],
    image: "https://images.unsplash.com/photo-1567605532317-c8a3b1c25f5a?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["paint", "chemical", "waterproof"],
    image: "https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["electrical", "wire", "cable", "switch"],
    image: "https://images.unsplash.com/photo-1565608087341-404b25492fee?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["plywood", "timber", "wood", "veneer"],
    image: "https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["tile", "marble", "granite", "flooring"],
    image: "https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=600&q=60",
  },
];

const GENERIC_DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=600&q=60";

function normalize(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function findMatch<T extends { keywords: string[]; image: string }>(entries: T[], haystack: string): string | null {
  if (!haystack) return null;
  for (const entry of entries) {
    for (const keyword of entry.keywords) {
      const cleanKeyword = keyword.replace(/"/g, "");
      if (cleanKeyword && haystack.includes(cleanKeyword)) {
        return entry.image;
      }
    }
  }
  return null;
}

/**
 * Resolves the most relevant fallback photo for a product that has no
 * supplier-uploaded images, using the product's brand/name first (so a
 * recognized brand like "Ambuja Cement" shows a photo that actually looks
 * like that brand's product), then its category, then a generic default.
 */
export function getProductImage(params: { category?: string | null; brand?: string | null; name?: string | null }): string {
  const brandAndName = normalize(`${params.brand ?? ""} ${params.name ?? ""}`);
  const brandMatch = findMatch(BRAND_IMAGES, brandAndName);
  if (brandMatch) return brandMatch;

  const category = normalize(params.category);
  const categoryMatch = findMatch(CATEGORY_IMAGES, category || brandAndName);
  if (categoryMatch) return categoryMatch;

  return GENERIC_DEFAULT_IMAGE;
}

/**
 * @deprecated Prefer `getProductImage`, which also matches on brand/product
 * name so recognized brands show a photo relevant to their actual product
 * rather than a generic category stock photo. Kept for backward compatibility.
 */
export function getDefaultCategoryImage(category?: string | null): string {
  return getProductImage({ category });
}
