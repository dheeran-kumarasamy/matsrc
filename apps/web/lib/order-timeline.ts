// S12 Phase 1 — Defect B fix: pure, framework-agnostic view-model logic for
// components/orders/OrderTimeline.tsx, extracted so it is directly
// unit-testable without a DOM/rendering environment (this repo has no
// jsdom/testing-library setup — see apps/web/vitest.config.ts,
// environment: "node"), mirroring the existing pattern used by
// lib/order-confirmation.ts.
//
// Root cause this fixes: the customer-facing order detail page/overlay
// already fetch the real, persisted OrderTracking records for an Order
// (see apps/web/app/api/builder/orders/[id]/route.ts's
// `tracking: order.tracking.map(...)`), but the previous OrderTimeline
// component ignored them entirely and rendered a purely static,
// status-derived 5-step progression instead. This module turns the real
// tracking array into a display-ready list — never inventing an event
// that doesn't exist in the data.
//
// Scoping (S12 §12): the `tracking` input must always be scoped to a
// single Order by the caller — this module has no way to combine or leak
// sibling Orders' tracking; it only transforms whatever array it's given.

export type OrderTrackingEvent = {
  id: string;
  status: string;
  // Already resolves to `note || status` server-side (see the order
  // detail API route) — may be a free-text note (e.g. a supplier decline
  // reason, a dispatch note) or just the raw status token.
  label: string;
  recordedAt: string;
};

export type OrderTimelineDisplayEvent = {
  id: string;
  headline: string;
  // Already formatted using the existing en-IN date/time convention — see
  // formatRecordedAt below.
  formattedRecordedAt: string;
  // null (never an empty string) when there is no distinct supplier-
  // entered note beyond the bare status headline.
  note: string | null;
  isLatest: boolean;
};

// Mirrors the existing OrderStatusBadge/legacy static-step labels so the
// wording customers already recognise stays consistent — used as the
// headline for each real tracking event.
export const STATUS_HEADLINES: Record<string, string> = {
  PLACED: "Enquiry sent",
  PROCESSING: "Confirmed",
  DISPATCHED: "Dispatched",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Enquiry declined",
};

export function humanizeStatus(status: string): string {
  return STATUS_HEADLINES[status] ?? status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Matches the existing en-IN date/time display convention already used
// elsewhere in the app for OrderTracking.recordedAt (e.g. the supplier
// portal's order detail page's formatDateTime helper) — IST,
// day/month/year + hour:minute. No new date-formatting system introduced.
export function formatRecordedAt(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

// Transforms a raw OrderTracking[] (already scoped to a single Order by
// the caller, oldest-first per the existing `orderBy: { recordedAt: "asc" }`
// convention) into the display-ready shape OrderTimeline renders. Never
// fabricates an event: returns exactly one display entry per input event,
// in the same order, with no added/invented entries — an empty input
// produces an empty output (the component renders its own empty-state
// copy in that case).
export function buildTimelineDisplayEvents(tracking: OrderTrackingEvent[] | undefined | null): OrderTimelineDisplayEvent[] {
  const events = tracking ?? [];
  return events.map((event, i) => {
    const headline = STATUS_HEADLINES[event.status] ?? humanizeStatus(event.status);
    // `label` already resolves to `note || status` server-side — only
    // surface it as a separate note when it's genuinely distinct free
    // text, not a redundant repeat of the headline/status token.
    const note = event.label && event.label !== event.status ? event.label : null;
    return {
      id: event.id,
      headline,
      formattedRecordedAt: formatRecordedAt(event.recordedAt),
      note,
      isLatest: i === events.length - 1,
    };
  });
}
