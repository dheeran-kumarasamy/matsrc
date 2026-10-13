import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminRatingsService } from "./ratings.service";

function buildService(overrides: Partial<any> = {}) {
  const rating = {
    id: "rating-1",
    orderId: "order-1",
    deliveryRating: 5,
    qualityRating: 4,
    comment: "Great service",
    createdAt: new Date(),
    updatedAt: new Date(),
    receiptData: Buffer.from([0xff, 0xd8, 0xff]),
    receiptMimeType: "image/jpeg",
    receiptFileName: "rating-receipt-order-1.jpg",
    receiptSize: 3,
    receiptUploadedAt: new Date(),
    ...overrides,
  };

  const prisma: any = {
    supplierRating: {
      findUnique: vi.fn().mockResolvedValue(rating),
    },
  };

  const service = new AdminRatingsService(prisma as any);
  return { service, prisma, rating };
}

describe("AdminRatingsService.findByOrderId", () => {
  it("returns rating + receipt metadata (never raw bytes) for an existing rating", async () => {
    const { service } = buildService();
    const result = await service.findByOrderId("order-1");

    expect(result.deliveryRating).toBe(5);
    expect(result.qualityRating).toBe(4);
    expect(result.receipt).toEqual(
      expect.objectContaining({ fileName: "rating-receipt-order-1.jpg", mimeType: "image/jpeg", size: 3 })
    );
    expect(result).not.toHaveProperty("receiptData");
  });

  it("returns receipt: null when no receipt was uploaded", async () => {
    const { service } = buildService({ receiptFileName: null, receiptMimeType: null, receiptSize: null, receiptUploadedAt: null });
    const result = await service.findByOrderId("order-1");
    expect(result.receipt).toBeNull();
  });

  it("throws NotFoundException when no rating exists for the order", async () => {
    const { service, prisma } = buildService();
    prisma.supplierRating.findUnique.mockResolvedValue(null);
    await expect(service.findByOrderId("missing-order")).rejects.toThrow(NotFoundException);
  });
});

describe("AdminRatingsService.getReceipt", () => {
  it("returns the raw receipt bytes + mimeType + fileName for an existing receipt", async () => {
    const { service } = buildService();
    const result = await service.getReceipt("order-1");
    expect(result.receiptMimeType).toBe("image/jpeg");
    expect(result.receiptFileName).toBe("rating-receipt-order-1.jpg");
    expect(Buffer.isBuffer(result.receiptData)).toBe(true);
  });

  it("throws NotFoundException when the rating has no receipt uploaded", async () => {
    const { service } = buildService({ receiptData: null, receiptMimeType: null, receiptFileName: null });
    await expect(service.getReceipt("order-1")).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException when no rating exists at all for the order", async () => {
    const { service, prisma } = buildService();
    prisma.supplierRating.findUnique.mockResolvedValue(null);
    await expect(service.getReceipt("missing-order")).rejects.toThrow(NotFoundException);
  });
});
