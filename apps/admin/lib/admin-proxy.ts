export const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB limit for admin uploads/invoices

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

const ID_REGEX = '^[a-zA-Z0-9_-]+$';
const CATALOG_TABS = 'category|brand|grade|unit|products';

/**
 * Validates whether a given method and slug path are permitted in the Admin proxy.
 * Replaces wildcard admin/* with exact route checks across all approved admin domains.
 */
export function isAllowedAdminProxyRoute(slug: string, method: string): boolean {
  if (containsPathTraversal(slug)) {
    return false;
  }

  const m = method.toUpperCase();

  // 1. Public catalog & ticker
  if (m === 'GET') {
    if (/^public\/catalog\/(category|brand|grade|unit)$/.test(slug)) return true;
    if (slug === 'public/ticker' || slug === 'public/listings') return true;
  }

  // 2. Advance Payments
  if (m === 'GET' && slug === 'admin/advance-payments') return true;
  if (m === 'GET' && /^admin\/advance-payments\/[a-zA-Z0-9_-]+$/.test(slug)) return true;
  if ((m === 'POST' || m === 'PATCH') && /^admin\/advance-payments\/[a-zA-Z0-9_-]+\/(approve|reject)$/.test(slug)) return true;
  if (m === 'GET' && /^admin\/advance-payments\/[a-zA-Z0-9_-]+\/(screenshot|receipt\/pdf)$/.test(slug)) return true;

  // 3. Aggregation
  if (m === 'GET' && slug === 'admin/aggregation/pools') return true;
  if (m === 'POST' && /^admin\/aggregation\/pools\/[a-zA-Z0-9_-]+\/(finalize|cancel)$/.test(slug)) return true;

  // 4. Audit
  if (m === 'GET' && slug === 'admin/audit') return true;

  // 5. Catalog CRUD
  if (new RegExp(`^admin\\/catalog\\/(${CATALOG_TABS})$`).test(slug)) {
    if (m === 'GET' || m === 'POST') return true;
  }
  if (new RegExp(`^admin\\/catalog\\/(${CATALOG_TABS})\\/[a-zA-Z0-9_-]+$`).test(slug)) {
    if (m === 'GET' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') return true;
  }

  // 6. Dashboard
  if (m === 'GET' && slug === 'admin/dashboard') return true;

  // 7. Disputes
  if (m === 'GET' && slug === 'admin/disputes') return true;
  if (m === 'GET' && /^admin\/disputes\/[a-zA-Z0-9_-]+$/.test(slug)) return true;
  if (m === 'POST' && /^admin\/disputes\/[a-zA-Z0-9_-]+\/resolve$/.test(slug)) return true;

  // 8. GST Settings
  if (slug === 'admin/gst') {
    if (m === 'GET' || m === 'PATCH' || m === 'PUT') return true;
  }
  if (slug === 'admin/gst/advance-config') {
    if (m === 'GET' || m === 'PATCH' || m === 'PUT') return true;
  }

  // 9. ICICI Payments
  if (m === 'GET' && slug === 'admin/icici-payments') return true;
  if (m === 'POST' && slug === 'admin/icici-payments/reconcile') return true;

  // 10. Invoices & Orders
  if (m === 'GET' && slug === 'admin/invoices') return true;
  if (m === 'GET' && /^admin\/invoices\/[a-zA-Z0-9_-]+$/.test(slug)) return true;
  if (m === 'GET' && /^admin\/invoices\/[a-zA-Z0-9_-]+\/pdf$/.test(slug)) return true;
  if (m === 'GET' && /^admin\/orders\/[a-zA-Z0-9_-]+\/(rfq|rfq-pdf|invoice|invoice\/pdf)$/.test(slug)) return true;

  // 11. KYC
  if (m === 'GET' && slug === 'admin/kyc') return true;
  if (m === 'GET' && /^admin\/kyc\/[a-zA-Z0-9_-]+$/.test(slug)) return true;
  if (m === 'POST' && /^admin\/kyc\/[a-zA-Z0-9_-]+\/(approve|reject)$/.test(slug)) return true;

  // 12. Markup
  if (slug === 'admin/markup') {
    if (m === 'GET' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') return true;
  }

  // 13. Payments
  if (m === 'GET' && (slug === 'admin/payments' || slug === 'admin/payments/pending' || slug === 'admin/payments/verified')) return true;
  if (m === 'POST' && /^admin\/payments\/[a-zA-Z0-9_-]+\/(approve|reject)$/.test(slug)) return true;
  if (m === 'GET' && /^admin\/payments\/[a-zA-Z0-9_-]+\/screenshot$/.test(slug)) return true;

  // 14. Pricing
  if (slug === 'admin/pricing/anomalies') {
    if (m === 'GET') return true;
  }
  if (slug === 'admin/pricing/anomalies/bulk-resolve') {
    if (m === 'POST') return true;
  }
  if (/^admin\/pricing\/anomalies\/[a-zA-Z0-9_-]+\/(resolve|comment)$/.test(slug)) {
    if (m === 'POST') return true;
  }
  if (slug === 'admin/pricing/rollups') {
    if (m === 'GET') return true;
  }
  if (/^admin\/pricing\/rollups\/(daily\/preview|daily|monthly)$/.test(slug)) {
    if (m === 'POST') return true;
  }
  if (slug === 'admin/pricing/scheduler') {
    if (m === 'GET') return true;
  }
  if (slug === 'admin/pricing/scheduler/run') {
    if (m === 'POST') return true;
  }
  if (slug === 'admin/pricing/sources') {
    if (m === 'GET' || m === 'POST') return true;
  }
  if (/^admin\/pricing\/sources\/[a-zA-Z0-9_-]+$/.test(slug)) {
    if (m === 'GET' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') return true;
  }
  if (/^admin\/pricing\/sources\/[a-zA-Z0-9_-]+\/(status|test)$/.test(slug)) {
    if (m === 'PATCH' || m === 'POST') return true;
  }
  if (/^admin\/pricing\/endpoints\/[a-zA-Z0-9_-]+\/(status|retry)$/.test(slug)) {
    if (m === 'PATCH' || m === 'POST') return true;
  }
  if (slug === 'admin/pricing/sku/unmapped') {
    if (m === 'GET') return true;
  }

  // 15. Ratings
  if (m === 'GET' && slug === 'admin/ratings') return true;
  if (m === 'GET' && /^admin\/ratings\/[a-zA-Z0-9_-]+$/.test(slug)) return true;
  if (m === 'GET' && /^admin\/ratings\/[a-zA-Z0-9_-]+\/receipt$/.test(slug)) return true;

  // 16. Supplier Invoices
  if (m === 'GET' && slug === 'admin/supplier-invoices') return true;
  if (m === 'GET' && /^admin\/supplier-invoices\/[a-zA-Z0-9_-]+$/.test(slug)) return true;
  if ((m === 'POST' || m === 'PATCH') && /^admin\/supplier-invoices\/[a-zA-Z0-9_-]+\/(review|confirm|reject)$/.test(slug)) return true;
  if (m === 'GET' && /^admin\/supplier-invoices\/[a-zA-Z0-9_-]+\/file$/.test(slug)) return true;
  if (/^admin\/supplier-invoices\/[a-zA-Z0-9_-]+\/payments$/.test(slug)) {
    if (m === 'GET' || m === 'POST') return true;
  }

  // 17. Supplier Rejections
  if (m === 'GET' && slug === 'admin/supplier-rejections') return true;

  // 18. Vendors
  if (m === 'GET' && (slug === 'admin/vendors' || /^admin\/vendors\/[a-zA-Z0-9_-]+$/.test(slug))) return true;

  // 19. WhatsApp Alerts / Notifications
  if (m === 'GET' && (slug === 'admin/whatsapp-alerts/mode' || slug === 'admin/whatsapp-alerts/logs')) return true;
  if (m === 'POST' && slug === 'admin/whatsapp-alerts/test') return true;
  if (m === 'GET' && slug === 'admin/notifications/policies') return true;
  if (m === 'PATCH' && /^admin\/notifications\/policies\/[a-zA-Z0-9_-]+$/.test(slug)) return true;
  if (slug === 'admin/notifications/global-settings') {
    if (m === 'GET' || m === 'PATCH' || m === 'PUT') return true;
  }
  if (m === 'GET' && slug === 'admin/whatsapp-escalations') return true;

  // All other routes (including builder/* and arbitrary wildcards) are forbidden
  return false;
}
