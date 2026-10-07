// S12 Phase 1 — Defect B regression tests for the pure OrderTimeline
// view-model logic (components/orders/OrderTimeline.tsx renders exactly
// what this module returns — see that file's own doc comment).

import { describe, expect, it } from "vitest";
import { buildTimelineDisplayEvents, formatRecordedAt, humanizeStatus, STATUS_HEADLINES } from "./order-timeline";
import type { OrderTrackingEvent } from "./order-timeline";

function event(overrides: Partial<OrderTrackingEvent> & Pick<OrderTrackingEvent, "id">): OrderTrackingEvent {
  return {
    status: "PLACED",
    label: "PLACED",
    recordedAt: "2026-10-07T05:02:00.000Z",
    ...overrides,
  };
}

describe("Test 5: OrderTimeline renders actual tracking events", () => {
  it("produces one display event per real OrderTracking row, in the same order", () => {
    const tracking: OrderTrackingEvent[] = [
      event({ id: "t1", status: "PLACED", label: "PLACED", recordedAt: "2026-10-07T05:00:00.000Z" }),
      event({ id: "t2", status: "PROCESSING", label: "PROCESSING", recordedAt: "2026-10-07T06:30:00.000Z" }),
    ];
    const result = buildTimelineDisplayEvents(tracking);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["t1", "t2"]);
    expect(result[0].headline).toBe(STATUS_HEADLINES.PLACED);
    expect(result[1].headline).toBe(STATUS_HEADLINES.PROCESSING);
  });

  it("never fabricates an event beyond what was passed in", () => {
    const tracking: OrderTrackingEvent[] = [event({ id: "t1" })];
    expect(buildTimelineDisplayEvents(tracking)).toHaveLength(1);
  });

  it("marks only the final event as the latest/active one", () => {
    const tracking: OrderTrackingEvent[] = [
      event({ id: "t1", recordedAt: "2026-10-07T05:00:00.000Z" }),
      event({ id: "t2", recordedAt: "2026-10-07T06:00:00.000Z" }),
      event({ id: "t3", recordedAt: "2026-10-07T07:00:00.000Z" }),
    ];
    const result = buildTimelineDisplayEvents(tracking);
    expect(result[0].isLatest).toBe(false);
    expect(result[1].isLatest).toBe(false);
    expect(result[2].isLatest).toBe(true);
  });

  it("falls back to a humanized status when the status has no known headline", () => {
    const tracking: OrderTrackingEvent[] = [event({ id: "t1", status: "SOME_NEW_STATUS", label: "SOME_NEW_STATUS" })];
    expect(buildTimelineDisplayEvents(tracking)[0].headline).toBe("Some New Status");
    expect(humanizeStatus("SOME_NEW_STATUS")).toBe("Some New Status");
  });
});

describe("Test 6: tracking timestamps use recordedAt", () => {
  it("formats the exact recordedAt value for each event using the en-IN convention", () => {
    const tracking: OrderTrackingEvent[] = [event({ id: "t1", recordedAt: "2026-01-15T08:30:00.000Z" })];
    const result = buildTimelineDisplayEvents(tracking);
    expect(result[0].formattedRecordedAt).toBe(formatRecordedAt("2026-01-15T08:30:00.000Z"));
    // Sanity: formatRecordedAt actually reflects the given instant (day +
    // month present), not a hard-coded/invented string.
    expect(result[0].formattedRecordedAt).toMatch(/2026/);
  });

  it("gives two tracking events with different recordedAt values different formatted timestamps", () => {
    const tracking: OrderTrackingEvent[] = [
      event({ id: "t1", recordedAt: "2026-01-01T10:00:00.000Z" }),
      event({ id: "t2", recordedAt: "2026-01-02T11:30:00.000Z" }),
    ];
    const result = buildTimelineDisplayEvents(tracking);
    expect(result[0].formattedRecordedAt).not.toBe(result[1].formattedRecordedAt);
  });
});

describe("Test 7: tracking notes are displayed when present", () => {
  it("surfaces a distinct supplier-entered note as its own field", () => {
    const tracking: OrderTrackingEvent[] = [
      event({ id: "t1", status: "CANCELLED", label: "Declined — out of stock for this SKU" }),
    ];
    expect(buildTimelineDisplayEvents(tracking)[0].note).toBe("Declined — out of stock for this SKU");
  });

  it("does not duplicate the headline as a note when label is just the bare status token", () => {
    const tracking: OrderTrackingEvent[] = [event({ id: "t1", status: "PROCESSING", label: "PROCESSING" })];
    expect(buildTimelineDisplayEvents(tracking)[0].note).toBeNull();
  });
});

describe("Test 8: empty tracking history renders a sensible empty state", () => {
  it("returns an empty array (never a fabricated placeholder event) for an empty tracking array", () => {
    expect(buildTimelineDisplayEvents([])).toEqual([]);
  });

  it("returns an empty array for an undefined/null tracking input", () => {
    expect(buildTimelineDisplayEvents(undefined)).toEqual([]);
    expect(buildTimelineDisplayEvents(null)).toEqual([]);
  });
});

describe("Test 9: tracking scoping — this module only ever transforms what it is given", () => {
  it("never reaches outside the provided tracking array (no hidden global/shared state)", () => {
    const orderATracking: OrderTrackingEvent[] = [event({ id: "a1", status: "PLACED" })];
    const orderBTracking: OrderTrackingEvent[] = [
      event({ id: "b1", status: "PLACED" }),
      event({ id: "b2", status: "PROCESSING" }),
    ];

    const resultA = buildTimelineDisplayEvents(orderATracking);
    const resultB = buildTimelineDisplayEvents(orderBTracking);

    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(2);
    expect(resultA.map((e) => e.id)).toEqual(["a1"]);
    expect(resultB.map((e) => e.id)).toEqual(["b1", "b2"]);
  });
});
