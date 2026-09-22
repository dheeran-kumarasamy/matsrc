import { describe, it, expect } from "vitest";
import {
  getAvailableActions,
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

  it("returns 'Enquiry Declined' for CANCELLED", () => {
    expect(getReadOnlyStatusLabel("CANCELLED")).toBe("Enquiry Declined");
  });

  it("returns null for statuses that still have an available action", () => {
    expect(getReadOnlyStatusLabel("PLACED")).toBeNull();
    expect(getReadOnlyStatusLabel("PROCESSING")).toBeNull();
    expect(getReadOnlyStatusLabel("DISPATCHED")).toBeNull();
    expect(getReadOnlyStatusLabel("OUT_FOR_DELIVERY")).toBeNull();
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
