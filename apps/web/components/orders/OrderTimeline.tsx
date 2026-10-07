// S12 Phase 1 — Defect B fix: this timeline previously rendered a purely
// static, status-derived progression (5 hard-coded steps, "done" based
// only on the current Order.status) and completely ignored the real
// OrderTracking records already fetched by the order detail API/server
// function (apps/web/app/api/builder/orders/[id]/route.ts's
// `tracking: order.tracking.map(...)`). It now renders those actual
// tracking events — status, note, recordedAt — instead, via the pure,
// directly-unit-tested view-model logic in lib/order-timeline.ts. The
// Prisma OrderTracking model itself is unchanged; this is a
// presentation-layer fix only.
//
// Scoping (S12 §12): each Order's `tracking` prop must only ever be that
// Order's own OrderTracking rows — this component has no way to see or
// combine sibling Orders' tracking (it only receives what its caller
// passes), so there is no cross-supplier tracking leakage risk introduced
// here.
//
// No fabricated events: an event is only ever rendered if it exists in
// `tracking` (see buildTimelineDisplayEvents). The current Order status is
// used only for the CANCELLED special case and the Group & Save pooling
// context below — never to invent a tracking history entry that doesn't
// exist.
import { buildTimelineDisplayEvents, type OrderTrackingEvent } from "@/lib/order-timeline";

export type { OrderTrackingEvent };

type Status = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

type OrderTimelineProps = {
  status: Status;
  // Real OrderTracking events for THIS Order only, already fetched by the
  // caller (order detail API/server function) — oldest first, matching
  // the existing `orderBy: { recordedAt: "asc" }` convention. Optional for
  // backward compatibility with any caller that hasn't been updated yet;
  // treated the same as an empty array (graceful empty state).
  tracking?: OrderTrackingEvent[];
  isAggregated?: boolean;
  poolLocked?: boolean;
};

export default function OrderTimeline({ status, tracking, isAggregated, poolLocked }: OrderTimelineProps) {
  if (status === "CANCELLED") {
    return (
      <div className="rounded-2xl border border-[color:var(--posh-primary)] bg-[color:var(--posh-bg-card)] p-4 text-sm text-[color:var(--posh-fg)]">
        <p className="font-bold">Enquiry declined</p>
        <p className="mt-1 font-medium text-[color:var(--posh-fg-muted)]">The supplier declined this enquiry before confirmation. You can place a new request with another supplier.</p>
      </div>
    );
  }

  const events = buildTimelineDisplayEvents(tracking);

  // Group & Save / aggregation context (unrelated to OrderTracking — see
  // AggregationPool/AggregationParticipant) is preserved unchanged; this
  // is existing, correctly-scoped Group & Save business logic, not a
  // "Group Order" mislabel.
  const poolingSteps = isAggregated
    ? [
        { key: "pooling", label: "Pooling", desc: "Waiting for other builders to join and unlock a better price", done: true },
        {
          key: "price-locked",
          label: "Price Locked",
          desc: poolLocked
            ? "Group pool locked — this order now proceeds at the locked price"
            : "Pool will lock once the window closes or the top tier is reached",
          done: Boolean(poolLocked),
        },
      ]
    : [];


  return (
    <div className="relative">
      {poolingSteps.map((step, i) => (
        <div key={step.key} className="flex gap-4 pb-6 last:pb-0 relative">
          <div className={`absolute left-3.5 top-7 bottom-0 w-0.5 ${step.done ? "bg-[color:var(--posh-primary)]" : "bg-[rgba(var(--posh-wash-rgb),0.06)]"}`} />
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold z-10 ${
              step.done ? "bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)]" : "bg-[rgba(var(--posh-wash-rgb),0.06)] text-[color:var(--posh-fg-muted)]"
            }`}
          >
            {step.done ? "✓" : i + 1}
          </div>
          <div className="pt-0.5">
            <p className={`text-sm font-bold ${step.done ? "text-[color:var(--posh-fg)]" : "text-[color:var(--posh-fg-muted)]"}`}>{step.label}</p>
            <p className="text-xs font-medium text-[color:var(--posh-fg-muted)]">{step.desc}</p>
          </div>
        </div>
      ))}

      {events.length === 0 ? (
        <p className="text-sm font-medium text-[color:var(--posh-fg-muted)]">
          Tracking updates will appear here as your order progresses.
        </p>
      ) : (
        events.map((event, i) => (
          <div key={event.id} className="flex gap-4 pb-6 last:pb-0 relative">
            {i < events.length - 1 && (
              <div className="absolute left-3.5 top-7 bottom-0 w-0.5 bg-[color:var(--posh-primary)]" />
            )}
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold z-10 bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)] ${
                event.isLatest ? "ring-4 ring-[color:var(--posh-border)]" : ""
              }`}
            >
              ✓
            </div>
            <div className="pt-0.5">
              <p className="text-sm font-bold text-[color:var(--posh-fg)]">{event.headline}</p>
              <p className="text-xs font-medium text-[color:var(--posh-fg-muted)]">{event.formattedRecordedAt}</p>
              {event.note ? <p className="mt-0.5 text-xs font-medium text-[color:var(--posh-fg-muted)]">{event.note}</p> : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
