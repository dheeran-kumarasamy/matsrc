// Pure route-matching helpers used by middleware.ts — extracted so the P0
// routing/auth-protection rules can be unit tested without needing to spin
// up Next.js middleware/edge runtime.

// Route prefixes that expose user-specific data (orders, reports, alerts,
// cart/checkout, watchlist, purchase orders, credit, profile, disputes,
// group-orders, dashboard) and therefore require an authenticated session.
export const PROTECTED_PREFIXES = [
  "/newdashboard",
  "/orders",
  "/reports",
  "/notifications",
  "/watchlist",
  "/purchase-orders",
  "/credit",
  "/cart",
  "/checkout",
  "/disputes",
  "/group-orders",
  "/profile",
  "/sites",
  // AI Sourcing Assistant — session/conversation state is per-customer, so the
  // page requires a signed-in builder just like every other portal route. The
  // /api/builder/sourcing/* endpoints are already covered by the
  // /api/builder prefix check in middleware.ts.
  "/sourcing",
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// P0 fix (Phase 7/8): the per-product price report (/products/<id>/report)
// was reachable by anyone — it isn't listed in PROTECTED_PREFIXES (which only
// matches whole top-level prefixes, and /products itself must stay public for
// catalogue browsing). The page rendered fine, but the client-side data fetch
// then failed with a quiet inline "Not authenticated" message instead of the
// same middleware-level login redirect every other report-like route
// (/reports) gets. This makes protection consistent without touching the
// public /products and /products/<id> catalogue/PDP routes.
export function isProductReportRoute(pathname: string): boolean {
  return /^\/products\/[^/]+\/report(\/.*)?$/.test(pathname);
}

export function isProtectedRoute(pathname: string): boolean {
  if (isProductReportRoute(pathname)) return true;
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

// P0 fix (Phase 6): there is no legacy `/dashboard` route/page in this app —
// `/newdashboard` is the actively-maintained canonical customer dashboard.
// This redirect exists purely as a safety net for anyone assuming the more
// conventional `/dashboard` path (old bookmarks, muscle memory, external
// links) rather than as a "retire an obsolete duplicate" migration.
export function isLegacyDashboardRoute(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}
