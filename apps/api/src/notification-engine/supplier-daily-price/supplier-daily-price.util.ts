// Shared helpers for the Supplier Daily Price Update workflow —
// factored out of supplier-daily-price-reminder.service.ts so
// SupplierDailyPriceReplyFlow (apps/api/src/whatsapp/flows/
// supplier-daily-price-reply.flow.ts) can build/validate against the exact
// same dedupe key and portal deep link, rather than re-deriving either in a
// second place that could silently drift.

/**
 * The single canonical identifier for a supplier's daily price-update
 * "session" — see SupplierDailyPriceReplyFlow's doc comment: an unresolved
 * `NotificationEvent` row for this dedupeKey IS that session. Both the
 * reminder sender and every reply-flow lookup (price-reply, preview,
 * CONFIRM, CANCEL) MUST use this exact function so they can never drift
 * into comparing differently-shaped keys.
 */
export function buildDailyPriceDedupeKey(supplierId: string, businessDate: string): string {
  return `SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:${supplierId}:${businessDate}`;
}

// Repository audit (Phase 0) found no standalone "/supplier/pricing" route —
// the actual Buildohub supplier route where suppliers update product prices
// is apps/supplier's existing "/listings" page (see
// apps/supplier/app/(supplier)/listings and
// apps/api/src/whatsapp/flows/price-update.flow.ts, which links suppliers to
// the same route for the identical price-update action). The spec's example
// deep link ("/supplier/pricing") is documented as an assumption deviation
// in the deliverables report — this uses the real existing route instead of
// fabricating a new one. Never hardcode an environment-specific host here —
// always resolve through the configured SUPPLIER_PORTAL_URL /
// NEXT_PUBLIC_SUPPLIER_APP_URL env vars, falling back to the shared default
// used throughout this module.
export function supplierPricingDeepLink(): string {
  const baseUrl = process.env.SUPPLIER_PORTAL_URL || process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";
  return `${baseUrl.replace(/\/$/, "")}/listings`;
}

// ─────────────────────────────────────────────
// Supplier Daily Price Update — Preview/Confirm/Cancel + SAME-confirmation
// durable state.
//
// Deliberately stored inside the EXISTING `NotificationEvent.payload` JSON
// column (the same row that already IS the daily price-update "session" —
// see SupplierDailyPriceReplyFlow's doc comment) rather than a new Prisma
// model/migration: this state is 1:1 with that row's lifetime (it only
// matters for as long as the row's own dedupeKey/business-date session is
// active, and is irrelevant once a new business date rolls over to a brand
// new row), so no additional table is needed to keep it durable across
// serverless instances — every read/write goes through the one existing
// NotificationEvent row via Postgres, never process memory.
// ─────────────────────────────────────────────

export type DailyPricePreviewChangeLine = {
  kind: "CHANGE";
  productId: string;
  productName: string;
  unit: string | null;
  /** Product.basePrice (as its Decimal .toString() value) at the moment this preview was created — used at CONFIRM time to detect a price that drifted out from under the preview (e.g. edited via the portal) before the supplier confirmed. */
  currentPriceAtPreview: string;
  proposedPrice: string;
};

export type DailyPricePreviewSameLine = {
  kind: "SAME";
  productId: string;
  productName: string;
  unit: string | null;
  currentPriceAtPreview: string;
};

export type DailyPricePreviewLine = DailyPricePreviewChangeLine | DailyPricePreviewSameLine;

export type DailyPricePendingPreview = {
  /** Random per-preview token used as the compare-and-swap guard so CONFIRM can atomically "claim" exactly one preview even under concurrent/duplicate webhook deliveries — see consumePendingPricePreview. */
  previewToken: string;
  createdAt: string; // ISO timestamp
  lines: DailyPricePreviewLine[];
};

export type DailyPriceNotificationPayload = {
  supplierId?: string;
  businessDate?: string;
  missingProducts?: string[];
  /** Product ids this supplier has explicitly CONFIRMed as "SAME" (unchanged) for this business date — satisfies daily completeness for that product WITHOUT a PriceSnapshot row, per the confirmed product decision that SAME must never fabricate a snapshot. */
  confirmedSameProductIds?: string[];
  pendingPreview?: DailyPricePendingPreview | null;
  [key: string]: unknown;
};

/** Safely narrows an arbitrary `NotificationEvent.payload` JSON value to the typed shape this workflow expects, defaulting every field rather than throwing on an unexpected/legacy shape. */
export function parseDailyPricePayload(payload: unknown): DailyPriceNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as DailyPriceNotificationPayload;
}

// Reuses the same 15-minute value as the bot's general session idle timeout
// (apps/api/src/whatsapp/whatsapp.types.ts's SESSION_IDLE_TIMEOUT_MS) for a
// consistent "how long is a supplier's in-progress action considered live"
// convention across the bot, rather than inventing an unrelated duration.
export const PENDING_PRICE_PREVIEW_TTL_MS = 15 * 60 * 1000;

export function isPendingPreviewExpired(preview: DailyPricePendingPreview, now: Date = new Date()): boolean {
  const createdAtMs = new Date(preview.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return true;
  return now.getTime() - createdAtMs > PENDING_PRICE_PREVIEW_TTL_MS;
}
