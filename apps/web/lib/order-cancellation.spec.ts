import { describe, expect, it } from "vitest";
import {
  builderCancellationRejectionReason,
  isBuilderCancellableOrderStatus,
  type OrderStatus,
} from "./order-cancellation";

describe("isBuilderCancellableOrderStatus", () => {
  it("allows cancellation only while the order is PLACED (awaiting supplier confirmation)", () => {
    expect(isBuilderCancellableOrderStatus("PLACED")).toBe(true);
  });

  it("rejects cancellation once a supplier has confirmed the enquiry (PROCESSING)", () => {
    expect(isBuilderCancellableOrderStatus("PROCESSING")).toBe(false);
  });

  const irreversibleStatuses: OrderStatus[] = ["DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];
  it.each(irreversibleStatuses)("rejects cancellation once the order has reached %s", (status) => {
    expect(isBuilderCancellableOrderStatus(status)).toBe(false);
  });
});

describe("builderCancellationRejectionReason", () => {
  it("gives an 'already cancelled' message for an already-CANCELLED order", () => {
    expect(builderCancellationRejectionReason("CANCELLED")).toMatch(/already cancelled/i);
  });

  it("gives a generic 'too late to cancel' message for any other non-cancellable status", () => {
    expect(builderCancellationRejectionReason("DELIVERED")).toMatch(/no longer be cancelled/i);
    expect(builderCancellationRejectionReason("DISPATCHED")).toMatch(/no longer be cancelled/i);
  });
});
