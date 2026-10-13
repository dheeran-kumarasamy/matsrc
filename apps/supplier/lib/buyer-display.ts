// Central single source of truth for buyer/builder display naming across the
// supplier portal — mirrors apps/web/lib/supplier-display.ts's supplier-side
// equivalent. When HIDE_BUYER_NAMES is set to true, real buyer/builder names
// are masked and anonymized as "Buyer 1", "Buyer 2", etc.
//
// Change HIDE_BUYER_NAMES to false when you want to display real buyer
// names in the supplier portal.
//
// Flipped to true: the supplier portal must stop displaying real buyer
// names anywhere a buyer identity is shown to a supplier (orders list/
// detail, purchase orders list/detail, order detail modal).

export const HIDE_BUYER_NAMES = true;

const buyerIndexMap = new Map<string, number>();

/**
 * Returns anonymized buyer display name ("Buyer 1", "Buyer 2", etc.) if
 * HIDE_BUYER_NAMES is true, or the real buyer name if HIDE_BUYER_NAMES is
 * false.
 */
export function getBuyerDisplayName(
  buyerName?: string | null,
  buyerId?: string | null,
  fallbackIndex?: number
): string {
  if (!HIDE_BUYER_NAMES) {
    return buyerName?.trim() || "Buyer";
  }

  const key = (buyerId || buyerName || "").trim();

  if (!key) {
    if (typeof fallbackIndex === "number" && !isNaN(fallbackIndex)) {
      return `Buyer ${fallbackIndex + 1}`;
    }
    return "Buyer 1";
  }

  if (!buyerIndexMap.has(key)) {
    buyerIndexMap.set(key, buyerIndexMap.size + 1);
  }

  return `Buyer ${buyerIndexMap.get(key)}`;
}
