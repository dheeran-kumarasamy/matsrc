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

/**
 * Parses a free-text multi-line Daily Price Update reply (spec Phase 1 §13),
 * e.g.:
 *   TMT 10mm: 56000
 *   TMT 12mm - 57500
 *   M-Sand: 2100
 *
 * One line per product. Supports both `Name: Price` and `Name - Price`
 * (with reasonable whitespace variations) — NOT a general NLP/fuzzy parser;
 * a line that doesn't match either shape is simply omitted from the result
 * (the caller treats "zero pairs parsed" as "this message isn't a daily
 * price reply at all", and reports any still-unmatched *parsed* pairs back
 * to the supplier rather than silently guessing).
 *
 * The colon form is tried first and splits on the LAST colon in the line —
 * this deliberately allows product names that themselves contain a hyphen
 * (e.g. "M-Sand") to still parse correctly with the colon separator. The
 * dash form requires `<name> - <price>` with a space on both sides of the
 * dash, so it does not misfire on hyphenated product names with no spaces
 * around the hyphen.
 */
export function parseDailyPriceReplyInput(input: string): Array<{ product: string; price: string }> {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const pairs: Array<{ product: string; price: string }> = [];

  for (const line of lines) {
    const lastColon = line.lastIndexOf(":");
    if (lastColon > 0 && lastColon < line.length - 1) {
      const product = line.slice(0, lastColon).trim();
      const price = line.slice(lastColon + 1).trim();
      if (product && price) {
        pairs.push({ product, price });
        continue;
      }
    }

    const dashMatch = /^(.*\S)\s+-\s+(\S+)\s*$/.exec(line);
    if (dashMatch) {
      const [, product, price] = dashMatch;
      pairs.push({ product: product.trim(), price: price.trim() });
    }
  }

  return pairs;
}
