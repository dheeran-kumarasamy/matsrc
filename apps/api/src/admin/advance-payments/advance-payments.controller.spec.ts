// Unit tests for AdvancePaymentsController, focused on the new Admin
// receipt-access endpoint (GET :id/receipt/pdf). Instantiates the
// controller directly (same convention this repo already uses for service
// specs — e.g. advance-payments.service.spec.ts, invoices.service.spec.ts —
// rather than spinning up a full Nest TestingModule, since no such
// precedent exists elsewhere in this codebase) and separately exercises the
// real RoleGuard class to prove authorization is enforced at the guard
// layer, not merely by the controller trusting its caller.
import { Reflector } from "@nestjs/core";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdvancePaymentsController } from "./advance-payments.controller";
import { RoleGuard } from "../../auth/role.guard";

function buildController(receipt: any = null, error: Error | null = null) {
  const advancePaymentsService = {
    getReceipt: vi.fn().mockImplementation(async () => {
      if (error) throw error;
      return receipt;
    }),
  };
  const controller = new AdvancePaymentsController(advancePaymentsService as any);
  return { controller, advancePaymentsService };
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

describe("AdvancePaymentsController.getReceiptPdf", () => {
  it("delegates ownership/existence verification entirely to AdvancePaymentsService.getReceipt (never bypasses it)", async () => {
    const storedReceipt = {
      id: "receipt-1",
      receiptNumber: "AR/2601/00001",
      issuedAt: new Date("2026-01-15T00:00:00.000Z"),
      amount: 50000,
      balanceAfter: 50000,
      currency: "INR",
      paymentMethod: "MANUAL",
      paymentReferenceNo: "UTR123456",
      buyerName: "Builder",
      buyerEmail: "b@x.com",
      buyerPhone: "9876543210",
      advancePayment: { referenceNumber: "AP/2601/00001" },
    };
    const { controller, advancePaymentsService } = buildController(storedReceipt);
    const res = fakeResponse();

    await controller.getReceiptPdf("ap-1", res);

    expect(advancePaymentsService.getReceipt).toHaveBeenCalledWith("ap-1");
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(res.headers["Content-Disposition"]).toContain("attachment");
    expect(res.headers["Content-Disposition"]).toContain("AR-2601-00001.pdf");
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.send).toHaveBeenCalledTimes(1);
    const sentBuffer = res.send.mock.calls[0][0];
    expect(Buffer.isBuffer(sentBuffer)).toBe(true);
    expect(sentBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("propagates NotFoundException from the service when no receipt exists for this payment (missing receipt)", async () => {
    const { NotFoundException } = await import("@nestjs/common");
    const { controller } = buildController(null, new NotFoundException("No receipt exists for this advance payment"));
    const res = fakeResponse();

    await expect(controller.getReceiptPdf("ap-missing", res)).rejects.toThrow(NotFoundException);
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe("RoleGuard — admin/advance-payments authorization (unauthorized access)", () => {
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

  it("rejects a request with no resolved user at all", () => {
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
