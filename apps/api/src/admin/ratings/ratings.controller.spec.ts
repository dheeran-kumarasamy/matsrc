// Unit tests for AdminRatingsController, mirroring the existing
// advance-payments.controller.spec.ts convention exactly: instantiates the
// controller directly (no full Nest TestingModule precedent in this repo)
// and separately exercises the real RoleGuard class to prove authorization
// is enforced at the guard layer, not merely by the controller trusting
// its caller.
import { Reflector } from "@nestjs/core";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminRatingsController } from "./ratings.controller";
import { RoleGuard } from "../../auth/role.guard";

function buildController(receipt: any = null, error: Error | null = null) {
  const ratingsService = {
    findByOrderId: vi.fn(),
    getReceipt: vi.fn().mockImplementation(async () => {
      if (error) throw error;
      return receipt;
    }),
  };
  const controller = new AdminRatingsController(ratingsService as any);
  return { controller, ratingsService };
}

function fakeResponse() {
  const res: any = {
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    send: vi.fn(),
  };
  return res;
}

describe("AdminRatingsController.getReceipt", () => {
  it("delegates ownership/existence verification entirely to AdminRatingsService.getReceipt (never bypasses it) and sets safe headers", async () => {
    const storedReceipt = {
      receiptData: Buffer.from([0xff, 0xd8, 0xff]),
      receiptMimeType: "image/jpeg",
      receiptFileName: "rating-receipt-order-1.jpg",
    };
    const { controller, ratingsService } = buildController(storedReceipt);
    const res = fakeResponse();

    await controller.getReceipt("order-1", res);

    expect(ratingsService.getReceipt).toHaveBeenCalledWith("order-1");
    expect(res.headers["Content-Type"]).toBe("image/jpeg");
    expect(res.headers["Content-Disposition"]).toContain("rating-receipt-order-1.jpg");
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.send).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
  });

  it("propagates NotFoundException from the service when no receipt exists for this order (missing receipt)", async () => {
    const { controller } = buildController(null, new NotFoundException("No receipt found for this order"));
    const res = fakeResponse();

    await expect(controller.getReceipt("order-missing", res)).rejects.toThrow(NotFoundException);
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe("AdminRatingsController.findOne", () => {
  it("delegates to AdminRatingsService.findByOrderId", async () => {
    const { controller, ratingsService } = buildController();
    ratingsService.findByOrderId.mockResolvedValue({ id: "rating-1", orderId: "order-1" });

    const result = await controller.findOne("order-1");

    expect(ratingsService.findByOrderId).toHaveBeenCalledWith("order-1");
    expect(result).toEqual({ id: "rating-1", orderId: "order-1" });
  });
});

describe("RoleGuard — admin/ratings authorization (unauthorized access)", () => {
  function buildContext(user: any) {
    return {
      getHandler: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  }

  function buildReflectorReturning(roles: string[] | undefined) {
    return { get: vi.fn().mockReturnValue(roles) } as unknown as Reflector;
  }

  it("rejects a non-ADMIN caller (e.g. a buyer/BUILDER) with ForbiddenException before any controller method runs", () => {
    const guard = new RoleGuard(buildReflectorReturning(["ADMIN"]));
    expect(() => guard.canActivate(buildContext({ role: "BUILDER" }))).toThrow(ForbiddenException);
  });

  it("rejects a request with no resolved user at all (unauthenticated)", () => {
    const guard = new RoleGuard(buildReflectorReturning(["ADMIN"]));
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(ForbiddenException);
  });

  it("allows an ADMIN caller through", () => {
    const guard = new RoleGuard(buildReflectorReturning(["ADMIN"]));
    expect(guard.canActivate(buildContext({ role: "ADMIN" }))).toBe(true);
  });

  it("allows a SUPER_ADMIN caller through even though only ADMIN is listed in @Roles", () => {
    const guard = new RoleGuard(buildReflectorReturning(["ADMIN"]));
    expect(guard.canActivate(buildContext({ role: "SUPER_ADMIN" }))).toBe(true);
  });
});
