import { describe, it, expect } from "vitest";
import {
  getAvailableActions,
  getCancellationActor,
  getReadOnlyStatusLabel,
  isValidOrderStatusTransition,
} from "./order-status-transitions";

describe("getAvailableActions", () => {
  it("PLACED (pending enquiry) shows Confirm Enquiry and Decline Enquiry only", () => {
    const actions = getAvailableActions("PLACED");
    const labels = actions.map((a) => a.label);
    expect(labels).toContain("Confirm Enquiry");
    expect(labels).toContain("Decline Enquiry");
    expect(labels).not.toContain("Mark Dispatched");
    expect(labels).not.toContain("Mark Delivered");
  });

  it("PROCESSING (accepted enquiry) shows only Mark Dispatched", () => {
    const actions = getAvailableActions("PROCESSING");
    const labels = actions.map((a) => a.label);
    expect(labels).toEqual(["Mark Dispatched"]);
  });

  it("DISPATCHED shows only Mark Delivered", () => {
    const actions = getAvailableActions("DISPATCHED");
    const labels = actions.map((a) => a.label);
    expect(labels).toEqual(["Mark Delivered"]);
  });

  it("OUT_FOR_DELIVERY shows only Mark Delivered", () => {
    const actions = getAvailableActions("OUT_FOR_DELIVERY");
    const labels = actions.map((a) => a.label);
    expect(labels).toEqual(["Mark Delivered"]);
  });

  it("DELIVERED shows no actions", () => {
    expect(getAvailableActions("DELIVERED")).toEqual([]);
  });

  it("CANCELLED shows no actions", () => {
    expect(getAvailableActions("CANCELLED")).toEqual([]);
  });
});

describe("getReadOnlyStatusLabel", () => {
  it("returns 'Order Delivered' for DELIVERED", () => {
    expect(getReadOnlyStatusLabel("DELIVERED")).toBe("Order Delivered");
  });

  it("returns 'Cancelled by Builder' for a builder-initiated cancellation", () => {
    expect(
      getReadOnlyStatusLabel("CANCELLED", [{ status: "CANCELLED", note: "Cancelled by builder" }])
    ).toBe("Cancelled by Builder");
  });

  it("returns 'Declined by Supplier' for a genuine supplier decline", () => {
    expect(
      getReadOnlyStatusLabel("CANCELLED", [
        { status: "CANCELLED", note: "All eligible suppliers declined this enquiry" },
      ])
    ).toBe("Declined by Supplier");
  });

  it("returns the safe generic 'Cancelled' for a legacy/unknown cancellation actor", () => {
    // No tracking rows at all (legacy order predating OrderTracking, or the
    // caller didn't have tracking handy) — must never be misattributed to
    // the builder.
    expect(getReadOnlyStatusLabel("CANCELLED")).toBe("Cancelled");
    expect(getReadOnlyStatusLabel("CANCELLED", [])).toBe("Cancelled");
    // A CANCELLED tracking row whose note doesn't mention either actor.
    expect(getReadOnlyStatusLabel("CANCELLED", [{ status: "CANCELLED", note: "Order cancelled" }])).toBe(
      "Cancelled"
    );
  });

  it("returns null for statuses that still have an available action", () => {
    expect(getReadOnlyStatusLabel("PLACED")).toBeNull();
    expect(getReadOnlyStatusLabel("PROCESSING")).toBeNull();
    expect(getReadOnlyStatusLabel("DISPATCHED")).toBeNull();
    expect(getReadOnlyStatusLabel("OUT_FOR_DELIVERY")).toBeNull();
  });

  it("other status labels (Order Delivered, Order status: X) remain unchanged", () => {
    expect(getReadOnlyStatusLabel("DELIVERED")).toBe("Order Delivered");
  });
});

describe("getCancellationActor", () => {
  it("attributes a note mentioning 'builder' to BUILDER", () => {
    expect(getCancellationActor([{ status: "CANCELLED", note: "Cancelled by builder" }])).toBe("BUILDER");
    expect(
      getCancellationActor([{ status: "CANCELLED", note: "Builder opted out of aggregation pool" }])
    ).toBe("BUILDER");
  });

  it("attributes a note mentioning 'supplier'/'declined' to SUPPLIER", () => {
    expect(
      getCancellationActor([{ status: "CANCELLED", note: "All eligible suppliers declined this enquiry" }])
    ).toBe("SUPPLIER");
    expect(
      getCancellationActor([{ status: "CANCELLED", note: "Supplier marked order as cancelled" }])
    ).toBe("SUPPLIER");
  });

  it("uses only the most recent CANCELLED tracking entry, ignoring earlier ones", () => {
    expect(
      getCancellationActor([
        { status: "PLACED", note: "Order placed" },
        { status: "CANCELLED", note: "Supplier marked order as cancelled" },
      ])
    ).toBe("SUPPLIER");
  });

  it("returns UNKNOWN for an empty tracking list or an unrecognized note", () => {
    expect(getCancellationActor([])).toBe("UNKNOWN");
    expect(getCancellationActor([{ status: "CANCELLED", note: "Order cancelled" }])).toBe("UNKNOWN");
    expect(getCancellationActor([{ status: "CANCELLED", note: null }])).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when there is no CANCELLED entry at all", () => {
    expect(getCancellationActor([{ status: "PLACED", note: "Order placed" }])).toBe("UNKNOWN");
  });
});

describe("isValidOrderStatusTransition — backend transition guard", () => {
  it("allows Confirm (PLACED -> PROCESSING) and Decline (PLACED -> CANCELLED)", () => {
    expect(isValidOrderStatusTransition("PLACED", "PROCESSING")).toBe(true);
    expect(isValidOrderStatusTransition("PLACED", "CANCELLED")).toBe(true);
  });

  it("rejects Confirm/Decline after the enquiry has already been accepted", () => {
    expect(isValidOrderStatusTransition("PROCESSING", "PROCESSING")).toBe(false);
    expect(isValidOrderStatusTransition("PROCESSING", "CANCELLED")).toBe(false);
  });

  it("allows Dispatch only after acceptance (PROCESSING -> DISPATCHED)", () => {
    expect(isValidOrderStatusTransition("PROCESSING", "DISPATCHED")).toBe(true);
  });

  it("rejects Dispatch before acceptance", () => {
    expect(isValidOrderStatusTransition("PLACED", "DISPATCHED")).toBe(false);
  });

  it("allows Deliver only after dispatch (DISPATCHED|OUT_FOR_DELIVERY -> DELIVERED)", () => {
    expect(isValidOrderStatusTransition("DISPATCHED", "DELIVERED")).toBe(true);
    expect(isValidOrderStatusTransition("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
  });

  it("rejects Deliver before dispatch", () => {
    expect(isValidOrderStatusTransition("PLACED", "DELIVERED")).toBe(false);
    expect(isValidOrderStatusTransition("PROCESSING", "DELIVERED")).toBe(false);
  });

  it("rejects every transition once delivered (terminal state)", () => {
    expect(isValidOrderStatusTransition("DELIVERED", "PROCESSING")).toBe(false);
    expect(isValidOrderStatusTransition("DELIVERED", "DISPATCHED")).toBe(false);
    expect(isValidOrderStatusTransition("DELIVERED", "CANCELLED")).toBe(false);
  });

  it("rejects every transition once cancelled/declined (terminal state)", () => {
    expect(isValidOrderStatusTransition("CANCELLED", "PROCESSING")).toBe(false);
    expect(isValidOrderStatusTransition("CANCELLED", "DISPATCHED")).toBe(false);
    expect(isValidOrderStatusTransition("CANCELLED", "DELIVERED")).toBe(false);
  });
});
