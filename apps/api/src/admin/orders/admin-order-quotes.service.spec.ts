import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdminOrderQuotesService } from "./admin-order-quotes.service";
import { ReviewAction } from "./dto/review-supplier-quote.dto";
import { SupplierQuoteStatus } from "@matsrc/db";

describe("AdminOrderQuotesService", () => {
  let service: AdminOrderQuotesService;
  let prisma: any;
  let markupService: any;

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      supplierQuote: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };
    markupService = {
      resolveMarkupForProduct: vi.fn(),
    };
    service = new AdminOrderQuotesService(prisma, markupService);
  });

  describe("getQuotes", () => {
    it("throws NotFoundException if order does not exist", async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.getQuotes("non-existent")).rejects.toThrow(NotFoundException);
    });

    it("returns quotes with suggested markup preview and lock status", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        enquiryId: "EQ-001",
        status: "PLACED",
        paymentStatus: "PENDING",
        selectedSupplierId: null,
        selectedQuoteId: null,
        user: { name: "Builder Bob", email: "bob@example.com", phone: "9876543210" },
        items: [{ id: "item-1", quantity: 10, product: { id: "p-1", name: "Steel", unit: "MT", categoryId: "c-1" } }],
        purchaseOrders: [],
        supplierQuotes: [
          {
            id: "quote-1",
            enquiryId: "order-1",
            supplierId: "sup-1",
            supplier: { id: "sup-1", companyName: "Tata Steel" },
            lineItemId: "item-1",
            lineItem: { quantity: 10, product: { id: "p-1", name: "Steel", unit: "MT", categoryId: "c-1" } },
            unitPrice: 50000,
            currency: "INR",
            leadTimeDays: 3,
            status: SupplierQuoteStatus.PENDING_ADMIN_REVIEW,
            sentToBuyerAt: null,
            reviewedByAdminId: null,
            adminNotes: null,
            createdAt: new Date(),
            quantity: 10,
            gstRatePercent: 18,
            buyerUnitPrice: null,
            markupPercent: null,
            markupAmount: null,
          },
        ],
      });

      markupService.resolveMarkupForProduct.mockResolvedValue({
        supplierUnitPrice: 50000,
        buyerUnitPrice: 52500,
        markupPercent: 5,
        markupAmount: 2500,
      });

      const result = await service.getQuotes("order-1");
      expect(result.orderId).toBe("order-1");
      expect(result.isLocked).toBe(false);
      expect(result.quotes).toHaveLength(1);
      expect(result.quotes[0]).toMatchObject({
        id: "quote-1",
        supplierUnitPrice: 50000,
        buyerUnitPrice: 52500,
        markupPercent: 5,
        markupAmount: 2500,
        status: SupplierQuoteStatus.PENDING_ADMIN_REVIEW,
        isCurrentlySelected: false,
      });
    });

    it("identifies order as locked when paymentStatus is PAID", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        status: "PROCESSING",
        paymentStatus: "PAID",
        user: null,
        items: [],
        purchaseOrders: [],
        supplierQuotes: [],
      });

      const result = await service.getQuotes("order-1");
      expect(result.isLocked).toBe(true);
      expect(result.lockReason).toBe("Payment completed");
    });

    it("identifies order as locked when purchase order has been generated", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        status: "PROCESSING",
        paymentStatus: "PENDING",
        user: null,
        items: [],
        purchaseOrders: [{ id: "po-1", poNumber: "PO-2026-00001", status: "ISSUED", version: 1 }],
        supplierQuotes: [],
      });

      const result = await service.getQuotes("order-1");
      expect(result.isLocked).toBe(true);
      expect(result.lockReason).toBe("Purchase Order generated");
    });
  });

  describe("reviewQuote", () => {
    it("rejects review if order is locked by payment", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        paymentStatus: "PAID",
        purchaseOrders: [],
      });

      await expect(
        service.reviewQuote("order-1", "q-1", { action: ReviewAction.SEND_TO_BUYER }, "admin-1")
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects review if order is locked by purchase order", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        paymentStatus: "PENDING",
        purchaseOrders: [{ id: "po-1" }],
      });

      await expect(
        service.reviewQuote("order-1", "q-1", { action: ReviewAction.SEND_TO_BUYER }, "admin-1")
      ).rejects.toThrow(BadRequestException);
    });

    it("successfully rejects a quote when action is REJECT", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        paymentStatus: "PENDING",
        purchaseOrders: [],
      });
      prisma.supplierQuote.findFirst.mockResolvedValue({
        id: "q-1",
        enquiryId: "order-1",
        lineItem: { product: {} },
      });
      prisma.supplierQuote.update.mockResolvedValue({
        id: "q-1",
        status: SupplierQuoteStatus.REJECTED,
        adminNotes: "Price too high",
      });

      const result = await service.reviewQuote(
        "order-1",
        "q-1",
        { action: ReviewAction.REJECT, adminNotes: "Price too high" },
        "admin-1"
      );

      expect(result.action).toBe("REJECTED");
      expect(prisma.supplierQuote.update).toHaveBeenCalledWith({
        where: { id: "q-1" },
        data: {
          status: SupplierQuoteStatus.REJECTED,
          reviewedByAdminId: "admin-1",
          adminNotes: "Price too high",
        },
      });
    });

    it("updates quote with custom markupPercent and sets status to SENT_TO_BUYER", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        paymentStatus: "PENDING",
        purchaseOrders: [],
      });
      prisma.supplierQuote.findFirst.mockResolvedValue({
        id: "q-1",
        enquiryId: "order-1",
        unitPrice: 100,
        quantity: 5,
        gstRatePercent: 18,
        lineItem: { quantity: 5, product: { id: "p-1", categoryId: "c-1" } },
      });
      prisma.supplierQuote.update.mockImplementation(async ({ data }: any) => ({
        id: "q-1",
        ...data,
      }));

      const result = await service.reviewQuote(
        "order-1",
        "q-1",
        { action: ReviewAction.SEND_TO_BUYER, markupPercent: 10 },
        "admin-1"
      );

      expect(result.action).toBe("SENT_TO_BUYER");
      expect(prisma.supplierQuote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "q-1" },
          data: expect.objectContaining({
            status: SupplierQuoteStatus.SENT_TO_BUYER,
            buyerUnitPrice: 110,
            markupPercent: 10,
            markupAmount: 10,
            lineSubtotal: 550, // 5 * 110
            gstAmount: 99,     // 18% of 550
            lineTotal: 649,    // 550 + 99
          }),
        })
      );
    });

    it("updates quote with flat buyerUnitPrice and computes derived markupPercent", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        paymentStatus: "PENDING",
        purchaseOrders: [],
      });
      prisma.supplierQuote.findFirst.mockResolvedValue({
        id: "q-1",
        enquiryId: "order-1",
        unitPrice: 100,
        quantity: 2,
        gstRatePercent: 18,
        lineItem: { quantity: 2, product: { id: "p-1", categoryId: "c-1" } },
      });
      prisma.supplierQuote.update.mockImplementation(async ({ data }: any) => ({
        id: "q-1",
        ...data,
      }));

      const result = await service.reviewQuote(
        "order-1",
        "q-1",
        { action: ReviewAction.SEND_TO_BUYER, buyerUnitPrice: 125 },
        "admin-1"
      );

      expect(result.action).toBe("SENT_TO_BUYER");
      expect(prisma.supplierQuote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "q-1" },
          data: expect.objectContaining({
            status: SupplierQuoteStatus.SENT_TO_BUYER,
            buyerUnitPrice: 125,
            markupPercent: 25,
            markupAmount: 25,
          }),
        })
      );
    });
  });

  describe("listOrders", () => {
    it("returns list of orders with quote counts and pendingReviewCount", async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: "order-1",
          orderNumber: "OD/001",
          enquiryId: "EQ/001",
          status: "PLACED",
          paymentStatus: "PENDING",
          createdAt: new Date(),
          user: { id: "u-1", name: "Builder A", email: "builder@a.com", phone: "123" },
          items: [{ id: "i-1", quantity: 5, product: { id: "p-1", name: "TMT Bar", unit: "MT" } }],
          purchaseOrders: [],
          supplierQuotes: [
            { id: "q-1", status: SupplierQuoteStatus.PENDING_ADMIN_REVIEW, unitPrice: 50000, buyerUnitPrice: null },
            { id: "q-2", status: SupplierQuoteStatus.SENT_TO_BUYER, unitPrice: 51000, buyerUnitPrice: 53550 },
          ],
        },
      ]);

      const result = await service.listOrders();
      expect(result).toHaveLength(1);
      expect(result[0].pendingReviewCount).toBe(1);
      expect(result[0].sentToBuyerCount).toBe(1);
      expect(result[0].totalQuotesCount).toBe(2);
      expect(result[0].isLocked).toBe(false);
    });
  });
});
