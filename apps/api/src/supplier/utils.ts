export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

// Product price formatting rule:
// 2 decimal places if fractional value is non-zero, decimals ignored if 0.
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

// Totals and currency calculations formatting rule:
// Always displayed with 2 decimal places even when zero.
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

export function formatDate(value: Date | null | undefined) {
  if (!value) return "TBD";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(value);
}

export function humanizeToken(value: string) {
  return value.replace(/_/g, " ");
}