export const MAX_BODY_BYTES = 1024 * 1024; // 1MB limit

export function getBackendApiUrl(): string {
  const configured = process.env.BACKEND_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error('BACKEND_API_URL must be configured in production');
  }
  return 'http://localhost:4000/api';
}

/**
 * Checks for path traversal attempts and invalid path sequences using multi-pass decoding.
 * Defends against single and double URL-encoded traversals (%2e%2e, %252e%252e),
 * encoded slashes (%2f), backslashes (%5c), double slashes (//), and null bytes (%00, \0).
 */
export function containsPathTraversal(raw: string): boolean {
  if (!raw) return false;

  // Quick check for immediate null bytes or backslashes
  if (raw.includes('\0') || raw.includes('\\')) return true;

  // Multi-pass iterative decoding (up to 3 passes to catch multi-encoded sequences)
  let current = raw;
  for (let i = 0; i < 3; i++) {
    // Check for suspicious patterns in the current representation
    const lower = current.toLowerCase();
    if (
      lower.includes('\0') ||
      lower.includes('%00') ||
      lower.includes('\\') ||
      lower.includes('%5c') ||
      lower.includes('//') ||
      lower.includes('%2f%2f')
    ) {
      return true;
    }

    // Split by slash and backslash to inspect individual path segments
    const segments = current.split(/[/\\]+/);
    for (const seg of segments) {
      const segLower = seg.toLowerCase().trim();
      if (
        segLower === '..' ||
        segLower === '.' ||
        segLower === '%2e%2e' ||
        segLower === '%2e' ||
        segLower === '%252e%252e' ||
        segLower === '%252e'
      ) {
        return true;
      }
    }

    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = decoded;
    } catch {
      // Malformed URL encoding is rejected
      return true;
    }
  }

  // Final segment check on fully decoded string
  const finalSegments = current.split(/[/\\]+/);
  for (const seg of finalSegments) {
    const s = seg.trim();
    if (s === '..' || s === '.') {
      return true;
    }
  }

  return false;
}

/**
 * Validates whether a given method and slug path are permitted in the Buyer proxy.
 * Strictly checks exact and parameterized routes; reject all wildcards.
 */
export function isAllowedRoute(slug: string, method: string): boolean {
  if (containsPathTraversal(slug)) {
    return false;
  }

  const normalizedMethod = method.toUpperCase();

  // 1. GET public/catalog/(category|brand|grade|unit)
  if (normalizedMethod === 'GET' && /^public\/catalog\/(category|brand|grade|unit)$/.test(slug)) {
    return true;
  }

  // 2. GET public/ticker
  if (normalizedMethod === 'GET' && slug === 'public/ticker') {
    return true;
  }

  // 3. GET public/listings
  if (normalizedMethod === 'GET' && slug === 'public/listings') {
    return true;
  }

  // 4. POST public/listings/:listingId/interest-event
  if (normalizedMethod === 'POST' && /^public\/listings\/[a-zA-Z0-9_-]+\/interest-event$/.test(slug)) {
    return true;
  }

  // 5. GET public/suppliers/:supplierId/ratings/summary
  if (normalizedMethod === 'GET' && /^public\/suppliers\/[a-zA-Z0-9_-]+\/ratings\/summary$/.test(slug)) {
    return true;
  }

  // 6. GET public/listings/:listingId/anchoring
  if (normalizedMethod === 'GET' && /^public\/listings\/[a-zA-Z0-9_-]+\/anchoring$/.test(slug)) {
    return true;
  }

  // 7. GET builder/aggregation/my-pools
  if (normalizedMethod === 'GET' && slug === 'builder/aggregation/my-pools') {
    return true;
  }

  // 8. GET builder/aggregation/pools/:id
  if (normalizedMethod === 'GET' && /^builder\/aggregation\/pools\/[a-zA-Z0-9_-]+$/.test(slug)) {
    return true;
  }

  // 9. POST builder/aggregation/opt-in
  if (normalizedMethod === 'POST' && slug === 'builder/aggregation/opt-in') {
    return true;
  }

  // 10. POST builder/aggregation/pools/:id/opt-out
  if (normalizedMethod === 'POST' && /^builder\/aggregation\/pools\/[a-zA-Z0-9_-]+\/opt-out$/.test(slug)) {
    return true;
  }

  return false;
}
