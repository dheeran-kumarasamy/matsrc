export type InterestEventType = "VIEW" | "CART_ADD" | "ORDER_PLACED";

const SESSION_KEY = "matsrc_interest_session_id";

function getSessionId() {
  if (typeof window === "undefined") return "server-session";

  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing) return existing;

  const next = typeof window.crypto?.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  window.localStorage.setItem(SESSION_KEY, next);
  return next;
}

export async function recordInterestEvent(listingId: string, eventType: InterestEventType) {
  if (!listingId || typeof window === "undefined") return;

  const sessionId = getSessionId();
  try {
    await fetch(`/api/proxy/public/listings/${listingId}/interest-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, sessionId }),
      keepalive: true,
    });
  } catch {
    // Fire-and-forget tracking; failures should not block UX.
  }
}

export async function getSupplierRatingsSummary(supplierId: string) {
  const response = await fetch(`/api/proxy/public/suppliers/${supplierId}/ratings/summary`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch supplier ratings summary");
  }

  return response.json() as Promise<{
    avgDeliveryRating: number | null;
    avgQualityRating: number | null;
    totalRatings: number;
    insufficientData: boolean;
  }>;
}

export async function getAnchoring(listingId: string) {
  const response = await fetch(`/api/proxy/public/listings/${listingId}/anchoring`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch anchoring insights");
  }

  return response.json() as Promise<{
    viewersLast24h: number;
    lockedPercent: number | null;
  }>;
}

// Additive (Phase 6A) — District Price Intelligence panel analytics. Not a
// generic analytics system; a minimal, purpose-built tracker backed by the
// existing AuditLog model via a dedicated builder API route (no new Prisma
// model, no new library). Fire-and-forget: tracking failures never affect UX.
export type PriceIntelligenceEventType =
  | "PANEL_OPENED"
  | "DISTRICT_CHANGED"
  | "COMPARISON_VIEWED"
  | "CSV_DOWNLOADED"
  | "TREND_RANGE_CHANGED"
  | "QUOTE_REQUESTED";

export async function recordPriceIntelligenceEvent(
  canonicalProductId: string,
  eventType: PriceIntelligenceEventType,
  metadata?: Record<string, unknown>
) {
  if (!canonicalProductId || typeof window === "undefined") return;

  try {
    await fetch("/api/builder/analytics/price-intelligence-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalProductId, eventType, metadata }),
      keepalive: true,
    });
  } catch {
    // Fire-and-forget tracking; failures should not block UX.
  }
}

