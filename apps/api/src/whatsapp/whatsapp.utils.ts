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
/**
 * Recognizes the `SAME` keyword a supplier can use in place of a numeric
 * price in a Daily Price Update reply line, to explicitly confirm that a
 * product's current base price is unchanged (see
 * SupplierDailyPriceReplyFlow). Case-insensitive, whitespace-tolerant.
 * Deliberately a single exact-word match (not a substring/fuzzy check) so
 * it can never be confused with a numeric value or a product name that
 * happens to contain "same".
 */
/**
 * Parses serial numbers from a selection message, e.g. "2, 3", "1, 5, 8", "2", "1 3", "1-3".
 * Returns an array of unique positive integers.
 */
export function parseSelectedSerials(input: string): number[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // Split on commas, spaces, semicolons, or "and"
  const tokens = trimmed.split(/[\s,;]+|\band\b/i).filter(Boolean);
  const serials: number[] = [];

  for (const token of tokens) {
    // Check for range like "1-3"
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start > 0 && end >= start && end - start <= 50) {
        for (let i = start; i <= end; i++) {
          serials.push(i);
        }
      }
      continue;
    }

    const num = Number(token.replace(/[^\d]/g, ""));
    if (Number.isInteger(num) && num > 0) {
      serials.push(num);
    }
  }

  return Array.from(new Set(serials));
}

/**
 * Parses serial-price lines, e.g.:
 *   "2 - 1520"
 *   "3 - 64500"
 *   "2: 1520"
 *   "3 = 64500"
 *   "2 1520"
 *   "2 - ₹1,520"
 *
 * If single serial is expected and user only enters a numeric price ("1520" or "₹1,520"),
 * it maps to that expected serial.
 */
export function parseSerialPriceInput(
  input: string,
  expectedSerials?: number[]
): Array<{ serial: number; price: number }> {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // Single-product selection fallback: if only 1 serial was selected and user inputs just a price
  if (expectedSerials && expectedSerials.length === 1) {
    const singlePrice = parsePositiveNumber(trimmed.replace(/[₹,]/g, ""));
    if (singlePrice !== null) {
      // Check if it's already a serial-price pattern like "1 5000" or "1 - 5000"
      const parts = trimmed.split(/[-:= \t]+/).filter(Boolean);
      if (parts.length === 1) {
        return [{ serial: expectedSerials[0], price: singlePrice }];
      }
    }
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const results: Array<{ serial: number; price: number }> = [];
  const seenSerials = new Set<number>();
  const expectedSet = expectedSerials && expectedSerials.length > 0 ? new Set(expectedSerials) : null;

  for (const line of lines) {
    // Also support comma-, semicolon-, or "and"-separated pairs on a single line:
    // e.g. "2 - 1520, 3 - 64500" or "4 -300 and 5-299"
    // Use lookahead so commas inside numbers like "1,520" are not split.
    const subSegments = line
      .split(/(?:,|;|\s+\band\b\s+)(?=\s*\d+(?:\s*[-:=]|\s+\d))/i)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const segment of subSegments) {
      // Match "<serial> <sep> <price>" where sep can be [-, :, =] with optional whitespace, OR whitespace \s+
      const match = /^(\d+)(?:\s*[-:=]\s*|\s+)[₹]?\s*([0-9,]+(?:\.[0-9]+)?)$/.exec(segment);
      if (match) {
        const serial = Number(match[1]);
        const price = parsePositiveNumber(match[2].replace(/,/g, ""));
        if (serial > 0 && price !== null && !seenSerials.has(serial)) {
          if (expectedSet && !expectedSet.has(serial)) {
            continue;
          }
          seenSerials.add(serial);
          results.push({ serial, price });
        }
      }
    }
  }

  return results;
}

export function isSameKeyword(value: string): boolean {
  const upper = value.trim().toUpperCase();
  return upper === "SAME" || upper === "ALL SAME" || upper === "NO CHANGE" || upper === "UNCHANGED";
}

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
