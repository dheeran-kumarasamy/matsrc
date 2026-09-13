// Central single source of truth for supplier display naming across the web app.
// When HIDE_SUPPLIER_NAMES is set to true, real supplier names are masked and
// anonymized as "Supplier 1", "Supplier 2", etc.
//
// Change HIDE_SUPPLIER_NAMES to false when you want to display real supplier names on the website.

export const HIDE_SUPPLIER_NAMES = false;

const supplierIndexMap = new Map<string, number>();

/**
 * Returns anonymized supplier display name ("Supplier 1", "Supplier 2", etc.)
 * if HIDE_SUPPLIER_NAMES is true, or the real supplier name if HIDE_SUPPLIER_NAMES is false.
 */
export function getSupplierDisplayName(
  supplierName?: string | null,
  supplierId?: string | null,
  fallbackIndex?: number
): string {
  if (!HIDE_SUPPLIER_NAMES) {
    return supplierName?.trim() || "Supplier";
  }

  const key = (supplierId || supplierName || "").trim();

  if (!key) {
    if (typeof fallbackIndex === "number" && !isNaN(fallbackIndex)) {
      return `Supplier ${fallbackIndex + 1}`;
    }
    return "Supplier 1";
  }

  if (!supplierIndexMap.has(key)) {
    supplierIndexMap.set(key, supplierIndexMap.size + 1);
  }

  return `Supplier ${supplierIndexMap.get(key)}`;
}
