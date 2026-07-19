// Default fallback images shown when a supplier hasn't uploaded any product photos.
// Keyed by a normalized (lowercased) category name / keyword.
const CATEGORY_DEFAULT_IMAGES: Record<string, string> = {
  steel: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=60",
  tmt: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=60",
  cement: "https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&w=600&q=60",
  aggregates: "https://images.unsplash.com/photo-1610500795312-4a5b6b2b6e2f?auto=format&fit=crop&w=600&q=60",
  pipes: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=600&q=60",
};

const GENERIC_DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=600&q=60";

export function getDefaultCategoryImage(category?: string | null): string {
  if (!category) return GENERIC_DEFAULT_IMAGE;

  const normalized = category.trim().toLowerCase();
  for (const key of Object.keys(CATEGORY_DEFAULT_IMAGES)) {
    if (normalized.includes(key)) {
      return CATEGORY_DEFAULT_IMAGES[key];
    }
  }

  return GENERIC_DEFAULT_IMAGE;
}
