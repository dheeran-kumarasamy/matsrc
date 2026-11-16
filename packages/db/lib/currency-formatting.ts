// Currency & Product Price Formatting Rules:
// "prices of products, totals, or any currency related information should be
// displayed with two decimal places but if the decimal values are 0 then
// they can be ignored for product prices but not for Totals and other currency calculations."

/**
 * Formats a product price (e.g. unit price, base price, asking price, listing price, catalog starting price):
 * - Displayed with two decimal places
 * - If the decimal values are 0 (e.g. 1250, 1250.00), decimals are ignored: "₹1,250"
 * - If the decimal values are non-zero (e.g. 1250.50, 1250.25), displayed with two decimal places: "₹1,250.50"
 */
export function formatProductPrice(value: number | string | { toNumber?: () => number } | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "object" && typeof value.toNumber === "function" ? value.toNumber() : Number(value);
  if (!Number.isFinite(num)) return String(value);

  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  const hasFraction = Math.abs(Math.round(abs * 100) % 100) !== 0;

  return `${sign}₹${abs.toLocaleString("en-IN", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Formats totals and other currency calculations (totals, subtotals, tax/GST, payable, amount paid/due,
 * line item totals, balance, refunds, revenue):
 * - Always displayed with two decimal places, even if decimal values are 0 (e.g. 1250 -> "₹1,250.00", 0 -> "₹0.00")
 */
export function formatCurrency(value: number | string | { toNumber?: () => number } | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "object" && typeof value.toNumber === "function" ? value.toNumber() : Number(value);
  if (!Number.isFinite(num)) return String(value);

  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);

  return `${sign}₹${abs.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
