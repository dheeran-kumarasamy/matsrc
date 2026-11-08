// Emoji fallback shown when a supplier hasn't uploaded any product photos.
// Keyed by a normalized (lowercased) category name / keyword. Reuses the same
// category set as the homepage's CategoryGrid so the icon a builder sees on
// the homepage tile matches the icon shown on product cards / quick view /
// the product detail page when no real photo is available.
const CATEGORY_EMOJIS: Record<string, string> = {
  steel: "🔩",
  tmt: "🔩",
  cement: "🏗️",
  brick: "🧱",
  block: "🧱",
  aggregate: "⛏️",
  sand: "⛏️",
  pipe: "🔧",
  fitting: "🔧",
  electrical: "⚡",
  wire: "⚡",
  plywood: "🪵",
  timber: "🪵",
  wood: "🪵",
  paint: "🎨",
  chemical: "🎨",
};

const GENERIC_EMOJI = "📦";

export function getCategoryEmoji(category?: string | null): string {
  if (!category) return GENERIC_EMOJI;

  const normalized = category.trim().toLowerCase();
  for (const key of Object.keys(CATEGORY_EMOJIS)) {
    if (normalized.includes(key)) {
      return CATEGORY_EMOJIS[key];
    }
  }

  return GENERIC_EMOJI;
}

type BrandImageEntry = {
  keywords: string[];
  image: string;
};

const BRAND_IMAGES: BrandImageEntry[] = [
  {
    keywords: ["ambuja"],
    image: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["ultratech"],
    image: "https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["acc cement", "acc limited", "\"acc\""],
    image: "https://images.unsplash.com/photo-1590247813693-5541d1c609fd?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["birla"],
    image: "https://images.unsplash.com/photo-1590247813693-5541d1c609fd?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["jsw"],
    image: "https://images.unsplash.com/photo-1587293852726-70cdb56c2866?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["tata steel", "tiscon", "tata tiscon"],
    image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["sail"],
    image: "https://images.unsplash.com/photo-1587293852726-70cdb56c2866?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["asian paints"],
    image: "https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["berger"],
    image: "https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["supreme", "astral", "finolex"],
    image: "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["havells", "polycab", "anchor"],
    image: "https://images.unsplash.com/photo-1565608087341-404b25492fee?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["century ply", "greenply", "century plyboards"],
    image: "https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["kajaria", "somany"],
    image: "https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=600&q=60",
  },
];

type CategoryImageEntry = {
  keywords: string[];
  image: string;
};

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
    image: "https://images.unsplash.com/photo-1578885136359-16c8bd4d3a8e?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["pipe", "fitting", "pvc", "cpvc"],
    image: "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?auto=format&fit=crop&w=600&q=60",
  },
  {
    keywords: ["brick", "block", "aac"],
    image: "https://images.unsplash.com/photo-1552666792-fff5d9eee6ac?auto=format&fit=crop&w=600&q=60",
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

export function getProductImage(params: { category?: string | null; brand?: string | null; name?: string | null }): string {
  const brandAndName = normalize(`${params.brand ?? ""} ${params.name ?? ""}`);
  const brandMatch = findMatch(BRAND_IMAGES, brandAndName);
  if (brandMatch) return brandMatch;

  const category = normalize(params.category);
  const categoryMatch = findMatch(CATEGORY_IMAGES, category || brandAndName);
  if (categoryMatch) return categoryMatch;

  return GENERIC_DEFAULT_IMAGE;
}

export function getDefaultCategoryImage(category?: string | null): string {
  return getProductImage({ category });
}
