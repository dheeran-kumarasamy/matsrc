import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdatePurchaseOrderDto, UpdatePurchaseOrderLineItemDto } from "./update-purchase-order.dto";

// These mirror the app's global ValidationPipe config (apps/api/src/main.ts:
// whitelist + forbidNonWhitelisted), which is what actually strips/rejects an
// unrecognized `quantity` field on an incoming PATCH request in production.
const PIPE_VALIDATE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

describe("UpdatePurchaseOrderLineItemDto", () => {
  it("has no quantity property declared — PO quantity cannot be set via this DTO's shape", () => {
    const instance = new UpdatePurchaseOrderLineItemDto();
    expect(Object.getOwnPropertyNames(instance)).not.toContain("quantity");
  });

  it("rejects a request payload that tries to smuggle a quantity field, exactly as the app's global ValidationPipe would", async () => {
    const instance = plainToInstance(UpdatePurchaseOrderLineItemDto, {
      id: "li-1",
      quantity: 999,
      deliveryDate: "2026-10-01",
    });

    const errors = await validate(instance, PIPE_VALIDATE_OPTIONS);
    expect(errors.some((e) => e.property === "quantity")).toBe(true);
  });

  it("validates successfully with only id and deliveryDate (no quantity)", async () => {
    const instance = plainToInstance(UpdatePurchaseOrderLineItemDto, {
      id: "li-1",
      deliveryDate: "2026-10-01",
    });

    const errors = await validate(instance, PIPE_VALIDATE_OPTIONS);
    expect(errors).toHaveLength(0);
  });
});

describe("UpdatePurchaseOrderDto", () => {
  it("rejects a nested line item quantity override under the app's global ValidationPipe rules", async () => {
    const instance = plainToInstance(UpdatePurchaseOrderDto, {
      notes: "please expedite",
      lineItems: [{ id: "li-1", quantity: 500, deliveryDate: "2026-10-01" }],
    });

    const errors = await validate(instance, PIPE_VALIDATE_OPTIONS);
    expect(errors.length).toBeGreaterThan(0);
  });
});

