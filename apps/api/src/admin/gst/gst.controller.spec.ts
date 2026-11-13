// Unit tests for GstController, mirroring the existing
// ratings.controller.spec.ts / advance-payments.controller.spec.ts
// convention exactly: instantiates the controller directly (no full Nest
// TestingModule precedent in this repo) and separately exercises the real
// RoleGuard class to prove authorization is enforced at the guard layer,
// not merely by the controller trusting its caller.
import { Reflector } from "@nestjs/core";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { GstController } from "./gst.controller";
import { RoleGuard } from "../../auth/role.guard";

function buildController() {
  const gstService = {
    listAll: vi.fn().mockResolvedValue({}),
    getGlobal: vi.fn().mockResolvedValue(null),
    upsertGlobal: vi.fn().mockResolvedValue({}),
    getCategoryOverride: vi.fn().mockResolvedValue(null),
    upsertCategoryOverride: vi.fn().mockResolvedValue({}),
    deleteCategoryOverride: vi.fn().mockResolvedValue({ deleted: true }),
    getProductOverride: vi.fn().mockResolvedValue(null),
    upsertProductOverride: vi.fn().mockResolvedValue({}),
    deleteProductOverride: vi.fn().mockResolvedValue({ deleted: true }),
    getEffectiveForProduct: vi.fn().mockResolvedValue({}),
    listTaxCoverage: vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 }),
  };
  const advanceConfigService = {
    get: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
  };
  const controller = new GstController(gstService as any, advanceConfigService as any);
  return { controller, gstService, advanceConfigService };
}

describe("GstController — delegation", () => {
  it("upsertGlobal passes the current user's id as actorId, defaulting to 'system' when absent", async () => {
    const { controller, gstService } = buildController();
    await controller.upsertGlobal({ percentage: 18, isEnabled: true }, { userId: "admin-1" });
    expect(gstService.upsertGlobal).toHaveBeenCalledWith(18, true, "admin-1");

    await controller.upsertGlobal({ percentage: 18, isEnabled: true }, undefined);
    expect(gstService.upsertGlobal).toHaveBeenCalledWith(18, true, "system");
  });

  it("upsertCategoryOverride delegates with categoryId from route params", async () => {
    const { controller, gstService } = buildController();
    await controller.upsertCategoryOverride("cat-1", { percentage: 12, isEnabled: true }, { userId: "admin-1" });
    expect(gstService.upsertCategoryOverride).toHaveBeenCalledWith("cat-1", 12, true, "admin-1");
  });

  it("upsertProductOverride delegates with productId from route params", async () => {
    const { controller, gstService } = buildController();
    await controller.upsertProductOverride("prod-1", { percentage: 5, isEnabled: true }, { userId: "admin-1" });
    expect(gstService.upsertProductOverride).toHaveBeenCalledWith("prod-1", 5, true, "admin-1");
  });

  it("listTaxCoverage parses query params and defaults onlyMissing to false", async () => {
    const { controller, gstService } = buildController();
    await controller.listTaxCoverage("cat-1", "cement", "true", "2", "25");
    expect(gstService.listTaxCoverage).toHaveBeenCalledWith({
      categoryId: "cat-1",
      search: "cement",
      onlyMissing: true,
      page: 2,
      pageSize: 25,
    });
  });

  it("getAdvanceConfig / upsertAdvanceConfig delegate to AdvanceConfigService", async () => {
    const { controller, advanceConfigService } = buildController();
    await controller.getAdvanceConfig();
    expect(advanceConfigService.get).toHaveBeenCalled();

    await controller.upsertAdvanceConfig({ percentage: 20, isEnabled: true }, { userId: "admin-1" });
    expect(advanceConfigService.upsert).toHaveBeenCalledWith(20, true, "admin-1");
  });
});

describe("RoleGuard — admin/gst authorization (unauthorized access)", () => {
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

  it("rejects a SUPPLIER caller", () => {
    const guard = new RoleGuard(buildReflectorReturning(["ADMIN"]));
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
