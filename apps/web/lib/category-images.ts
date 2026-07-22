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
