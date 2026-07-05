import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { BuilderOrdersService } from "./orders.service";

describe("BuilderOrdersService.create", () => {

  it("fans out supplier notifications for each grouped enquiry", async () => {
    const prisma = {
      cartItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            productId: "p1",
            quantity: 5,
            product: {
              supplierId: "sup-1",
              supplier: { companyName: "Supplier One" },
              basePrice: 100,
              pricingTiers: [],
            },
          },
          {
            productId: "p2",
            quantity: 2,
            product: {
              supplierId: "sup-2",
              supplier: { companyName: "Supplier Two" },
              basePrice: 200,
              pricingTiers: [],
            },
          },
        ]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      order: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: "ord-1", totalAmount: 500, items: [{ id: "i-1" }], status: "PLACED" })
          .mockResolvedValueOnce({ id: "ord-2", totalAmount: 400, items: [{ id: "i-2" }], status: "PLACED" }),
      },
    };

    const builderContext = {
      getOrCreateBuilder: vi.fn().mockResolvedValue({ user: { id: "builder-1" } }),
    };

    const notificationService = {
      notifySupplierOrderSubmitted: vi.fn().mockResolvedValue(undefined),
    };

    const service = new BuilderOrdersService(prisma as any, builderContext as any, notificationService as any);

    const result = await service.create(
      { userId: "builder-1", email: "builder@example.com", name: "Builder" },
      { paymentMethod: "BANK_TRANSFER" } as any
    );

    expect(result.orders).toHaveLength(2);
    expect(notificationService.notifySupplierOrderSubmitted).toHaveBeenCalledTimes(2);
    expect(notificationService.notifySupplierOrderSubmitted).toHaveBeenCalledWith("ord-1");
    expect(notificationService.notifySupplierOrderSubmitted).toHaveBeenCalledWith("ord-2");
  });
});

describe("BuilderOrdersService.upsertRating", () => {
  function buildService(orderOverrides: Partial<any> = {}, prismaOverrides: Partial<any> = {}) {
    const prisma = {
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-1",
          userId: "builder-1",
          status: "DELIVERED",
          items: [{ supplierId: "sup-1" }],
          supplierRating: null,
          ...orderOverrides,
        }),
      },
      supplierRating: {
        create: vi.fn().mockResolvedValue({
          id: "rating-1",
          orderId: "order-1",
          supplierId: "sup-1",
          deliveryRating: 5,
          qualityRating: 4,
          comment: null,
        }),
        update: vi.fn().mockResolvedValue({
          id: "rating-1",
          orderId: "order-1",
          supplierId: "sup-1",
          deliveryRating: 3,
          qualityRating: 3,
          comment: "Updated",
        }),
      },
      ...prismaOverrides,
    };

    const builderContext = {
      getOrCreateBuilder: vi.fn().mockResolvedValue({ user: { id: "builder-1" } }),
    };

    const notificationService = { notifySupplierOrderSubmitted: vi.fn() };

    const service = new BuilderOrdersService(prisma as any, builderContext as any, notificationService as any);
    return { service, prisma };
  }

  const userCtx = { userId: "builder-1", email: "builder@example.com", name: "Builder" };

  it("throws NotFoundException when the order does not belong to the builder", async () => {
    const { service, prisma } = buildService();
    prisma.order.findFirst = vi.fn().mockResolvedValue(null);

    await expect(
      service.upsertRating(userCtx, "order-1", { deliveryRating: 5, qualityRating: 5 } as any)
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects rating submission when order status is not DELIVERED", async () => {
    const { service } = buildService({ status: "PROCESSING" });

    await expect(
      service.upsertRating(userCtx, "order-1", { deliveryRating: 5, qualityRating: 5 } as any)
    ).rejects.toThrow(BadRequestException);
  });

  it("creates a new rating when none exists yet for a DELIVERED order", async () => {
    const { service, prisma } = buildService();

    const result = await service.upsertRating(userCtx, "order-1", {
      deliveryRating: 5,
      qualityRating: 4,
    } as any);

    expect(prisma.supplierRating.create).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(false);
    expect(result.deliveryRating).toBe(5);
  });

  it("updates the existing rating within the 72-hour edit window", async () => {
    const recentCreatedAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const { service, prisma } = buildService({
      supplierRating: { createdAt: recentCreatedAt },
    });

    const result = await service.upsertRating(userCtx, "order-1", {
      deliveryRating: 3,
      qualityRating: 3,
      comment: "Updated",
    } as any);

    expect(prisma.supplierRating.update).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(true);
  });

  it("rejects edits after the 72-hour edit window has expired", async () => {
    const staleCreatedAt = new Date(Date.now() - 73 * 60 * 60 * 1000); // 73 hours ago
    const { service } = buildService({
      supplierRating: { createdAt: staleCreatedAt },
    });

    await expect(
      service.upsertRating(userCtx, "order-1", { deliveryRating: 2, qualityRating: 2 } as any)
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects when the order has no resolvable supplier", async () => {
    const { service } = buildService({ items: [] });

    await expect(
      service.upsertRating(userCtx, "order-1", { deliveryRating: 5, qualityRating: 5 } as any)
    ).rejects.toThrow(BadRequestException);
  });
});

