import { describe, expect, it, vi, beforeEach } from "vitest";
import { SupplierRejectionsService } from "./supplier-rejections.service";

/**
 * Spec §G: "A rejection creates exactly one Admin flag record with reason + context,
 * and sends zero Builder-facing messages." This spec covers the read side — that the
 * enriched AuditLog row written by EnquiryDecisionFlow.finalizeRejection is correctly
 * surfaced (and non-flagged ENQUIRY_REJECT rows / other actions are excluded).
 */
function makeFakePrisma(logs: Array<Record<string, unknown>>) {
  return {
    auditLog: {
      findMany: vi.fn(async () => logs),
    },
  };
}

describe("SupplierRejectionsService.findRecent", () => {
  let service: SupplierRejectionsService;

  it("returns rejection records with full context (reason, enquiry, builder, product, supplier)", async () => {
    const prisma = makeFakePrisma([
      {
        id: "log-1",
        entityId: "order-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        metadata: {
          reason: "Out of stock",
          productName: "Cement",
          builderName: "Builder One",
          supplierId: "supplier-1",
          supplierName: "Supplier One",
          channel: "whatsapp",
          requiresAdminAction: true,
        },
      },
    ]);
    service = new SupplierRejectionsService(prisma as any);

    const result = await service.findRecent();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "log-1",
      enquiryId: "order-1",
      supplierId: "supplier-1",
      supplierName: "Supplier One",
      builderName: "Builder One",
      productName: "Cement",
      reason: "Out of stock",
    });
  });

  it("excludes ENQUIRY_REJECT rows that lack requiresAdminAction: true", async () => {
    const prisma = makeFakePrisma([
      {
        id: "log-2",
        entityId: "order-2",
        createdAt: new Date(),
        metadata: { reason: "Some other flow", requiresAdminAction: false },
      },
      {
        id: "log-3",
        entityId: "order-3",
        createdAt: new Date(),
        metadata: {},
      },
    ]);
    service = new SupplierRejectionsService(prisma as any);

    const result = await service.findRecent();

    expect(result).toHaveLength(0);
  });

  it("queries only ENQUIRY_REJECT actions on Order entities", async () => {
    const prisma = makeFakePrisma([]);
    service = new SupplierRejectionsService(prisma as any);

    await service.findRecent();

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: "ENQUIRY_REJECT", entityType: "Order" },
      })
    );
  });

  it("clamps an out-of-range limit into the [1, 200] window", async () => {
    const prisma = makeFakePrisma([]);
    service = new SupplierRejectionsService(prisma as any);

    await service.findRecent(10000);

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
  });
});
