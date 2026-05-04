export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function formatCurrency(value: number | string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function formatDate(value: Date | null | undefined) {
  if (!value) return "TBD";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(value);
}

export function humanizeToken(value: string) {
  return value.replace(/_/g, " ");
}