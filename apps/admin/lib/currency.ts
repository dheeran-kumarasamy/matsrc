// Currency & Product Price Formatting Rules for Admin Portal:
// "prices of products, totals, or any currency related information should be
// displayed with two decimal places but if the decimal values are 0 then
// they can be ignored for product prices but not for Totals and other currency calculations."

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
