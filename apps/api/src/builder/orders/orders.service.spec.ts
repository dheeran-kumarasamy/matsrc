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
