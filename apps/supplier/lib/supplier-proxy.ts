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
 * Validates whether a given method and slug path are permitted in the Supplier proxy.
 * Strictly enforces exact routes; rejects wildcards and unauthorized supplier endpoints.
 */
export function isAllowedSupplierProxyRoute(slug: string, method: string): boolean {
  if (containsPathTraversal(slug)) {
    return false;
  }

  const normalizedMethod = method.toUpperCase();

  // 1. Public catalog dropdowns
  if (normalizedMethod === 'GET' && /^public\/catalog\/(category|brand|grade|unit)$/.test(slug)) {
    return true;
  }

  // 2. Public ticker and listings
  if (normalizedMethod === 'GET' && (slug === 'public/ticker' || slug === 'public/listings')) {
    return true;
  }

  // 3. GET supplier/aggregation/pools
  if (normalizedMethod === 'GET' && slug === 'supplier/aggregation/pools') {
    return true;
  }

  // 4. POST supplier/aggregation/pools/:id/force-lock
  if (normalizedMethod === 'POST' && /^supplier\/aggregation\/pools\/[a-zA-Z0-9_-]+\/force-lock$/.test(slug)) {
    return true;
  }

  // All other routes, including arbitrary supplier/* wildcards, are strictly forbidden
  return false;
}
