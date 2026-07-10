/** Small parsing/validation helpers shared across bot flows. */

export function fuzzyMatch(query: string, candidates: Array<{ id: string; label: string }>): { id: string; label: string } | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  // Exact id match (e.g. selecting a list-message row id directly).
  const byId = candidates.find((candidate) => candidate.id === query.trim());
  if (byId) return byId;

  // Exact label match.
  const exact = candidates.find((candidate) => candidate.label.toLowerCase() === normalized);
  if (exact) return exact;

  // Substring match.
  const partial = candidates.filter((candidate) => candidate.label.toLowerCase().includes(normalized));
  if (partial.length === 1) return partial[0];

  // Token-overlap "fuzzy" fallback: pick candidate with most overlapping words.
  const queryTokens = new Set(normalized.split(/\s+/).filter(Boolean));
  let best: { candidate: { id: string; label: string }; score: number } | null = null;
  for (const candidate of candidates) {
    const candidateTokens = new Set(candidate.label.toLowerCase().split(/\s+/).filter(Boolean));
    let score = 0;
    for (const token of queryTokens) {
      if (candidateTokens.has(token)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { candidate, score };
    }
  }

  return best?.candidate ?? null;
}

export function parsePositiveNumber(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function isWithinSoftRange(newPrice: number, currentPrice: number, maxDeviationPct = 0.8): boolean {
  if (currentPrice <= 0) return true;
  const deviation = Math.abs(newPrice - currentPrice) / currentPrice;
  return deviation <= maxDeviationPct;
}

/** Parses the power-user bulk price-update syntax: `SKU1=Price1, SKU2=Price2`. */
export function parseBulkPriceInput(input: string): Array<{ sku: string; price: string }> {
  return input
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [sku, price] = pair.split("=").map((part) => part.trim());
      return { sku, price };
    })
    .filter((pair) => pair.sku && pair.price);
}

/** Validates and parses a delivery-date input of `TODAY` or `DD-MM-YYYY`. Returns null if invalid or in the future. */
export function parseDeliveryDate(input: string): Date | null {
  const trimmed = input.trim().toUpperCase();
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  if (trimmed === "TODAY") {
    return new Date();
  }

  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > now.getTime()) return null; // must not be in the future

  return date;
}

/** Matches the inline `DELIVERED <order-id>` command supported in the Order Status flow. */
export function matchDeliveredCommand(input: string): string | null {
  const match = /^DELIVERED\s+(.+)$/i.exec(input.trim());
  return match ? match[1].trim() : null;
}
