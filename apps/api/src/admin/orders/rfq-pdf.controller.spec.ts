// Unit tests for AdminRfqPdfController, mirroring
// admin/ratings/ratings.controller.spec.ts's exact convention: instantiate
// the controller directly, then separately exercise the real RoleGuard
// class to prove authorization is enforced at the guard layer (ADMIN /
// SUPER_ADMIN only), not merely trusted by the controller.
import { Reflector } from "@nestjs/core";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminRfqPdfController } from "./rfq-pdf.controller";
import { RoleGuard } from "../../auth/role.guard";

function buildController(result: any = null, error: Error | null = null) {
  const rfqPdfService = {
    getSummary: vi.fn(),
    renderPdf: vi.fn().mockImplementation(async () => {
      if (error) throw error;
      return result;
    }),
  };
  const controller = new AdminRfqPdfController(rfqPdfService as any);
  return { controller, rfqPdfService };
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

describe("AdminRfqPdfController.getRfqPdf", () => {
  it("renders the PDF via AdminRfqPdfService and sets the correct headers", async () => {
    const { controller, rfqPdfService } = buildController({ buffer: Buffer.from("%PDF-fake"), filename: "RFQ-EQ-1.pdf" });
    const res = fakeResponse();

    await controller.getRfqPdf("order-1", res);

    expect(rfqPdfService.renderPdf).toHaveBeenCalledWith("order-1");
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="RFQ-EQ-1.pdf"');
    expect(res.send).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
  });

  it("propagates NotFoundException from the service for a nonexistent RFQ, never swallowing it into a 200", async () => {
    const { controller } = buildController(null, new NotFoundException("RFQ not found"));
    const res = fakeResponse();

    await expect(controller.getRfqPdf("missing-order", res)).rejects.toThrow(NotFoundException);
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe("RoleGuard — admin/orders/:orderId/rfq authorization (unauthorized access)", () => {
  function buildContext(user: any) {
    return {
      getHandler: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  }

  function buildReflectorReturning(roles: string[] | undefined) {
    return { get: vi.fn().mockReturnValue(roles) } as unknown as Reflector;
  }

  it("rejects a non-ADMIN caller (e.g. a BUILDER or SUPPLIER) with ForbiddenException before any controller method runs", () => {
    const guard = new RoleGuard(buildReflectorReturning(["ADMIN"]));
    expect(() => guard.canActivate(buildContext({ role: "BUILDER" }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(buildContext({ role: "SUPPLIER" }))).toThrow(ForbiddenException);
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
