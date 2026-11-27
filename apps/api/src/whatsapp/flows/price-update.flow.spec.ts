import { describe, expect, it, vi, beforeEach } from "vitest";
import { PriceUpdateFlow, SerialMappingItem } from "./price-update.flow";
import { WhatsAppSession } from "../whatsapp.types";

function createMockSession(overrides: Partial<WhatsAppSession> = {}): WhatsAppSession {
  return {
    phone: "919876543210",
    userId: "user-1",
    email: "supplier@example.com",
    name: "Rajesh",
    supplierProfileId: "supplier-profile-1",
    language: "en",
    flow: "PRICE_UPDATE",
    step: "AWAITING_PRODUCT_SELECTION",
    context: {},
    invalidCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("PriceUpdateFlow", () => {
  let prisma: any;
  let listingsService: any;
  let sessionService: any;
  let audit: any;
  let dailyPriceReminder: any;
  let flow: PriceUpdateFlow;

  const sampleProducts = [
    {
      id: "prod-1",
      name: "OPC Cement",
      supplierId: "supplier-profile-1",
      isActive: true,
      basePrice: "395.00",
      unit: "bag",
      brandRef: { name: "UltraTech" },
      gradeRef: { name: "53 Grade" },
      unitRef: { symbol: "bag", name: "50 kg bag" },
      category: { name: "Cement" },
      sizeLabel: null,
    },
    {
      id: "prod-2",
      name: "M-Sand",
      supplierId: "supplier-profile-1",
      isActive: true,
      basePrice: "1450.00",
      unit: "ton",
      brandRef: null,
      gradeRef: null,
      unitRef: { symbol: "ton", name: "Ton" },
      category: { name: "Sand" },
      sizeLabel: "P-Sand",
    },
    {
      id: "prod-3",
      name: "TMT Steel",
      supplierId: "supplier-profile-1",
      isActive: true,
      basePrice: "64500.00",
      unit: "ton",
      brandRef: { name: "JSW" },
      gradeRef: { name: "Fe500D" },
      unitRef: { symbol: "ton", name: "Ton" },
      category: { name: "Steel" },
      sizeLabel: "12 mm",
    },
  ];

  beforeEach(() => {
    prisma = {
      product: {
        findMany: vi.fn().mockResolvedValue(sampleProducts),
      },
    };
    listingsService = {
      update: vi.fn().mockResolvedValue({ id: "prod-2", basePrice: "1520" }),
    };
    sessionService = {
      setFlow: vi.fn(),
      update: vi.fn(),
      resetToMainMenu: vi.fn(),
      incrementInvalid: vi.fn().mockReturnValue(1),
      withIdempotency: vi.fn().mockImplementation((_key, fn) => fn()),
    };
    audit = {
      record: vi.fn().mockResolvedValue({}),
    };
    dailyPriceReminder = {
      resolveIfComplete: vi.fn().mockResolvedValue({}),
    };

    flow = new PriceUpdateFlow(prisma, listingsService, sessionService, audit, dailyPriceReminder);
  });

  describe("start()", () => {
    it("retrieves active products, maps serial numbers (1..N), and displays catalogue", async () => {
      const session = createMockSession();
      const message = await flow.start(session);

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: "supplier-profile-1", isActive: true },
        })
      );

      expect(sessionService.setFlow).toHaveBeenCalledWith(
        "919876543210",
        "PRICE_UPDATE",
        "AWAITING_PRODUCT_SELECTION",
        expect.objectContaining({
          serialMapping: expect.arrayContaining([
            expect.objectContaining({ serial: 1, productId: "prod-1", currentPrice: 395 }),
            expect.objectContaining({ serial: 2, productId: "prod-2", currentPrice: 1450 }),
            expect.objectContaining({ serial: 3, productId: "prod-3", currentPrice: 64500 }),
          ]),
        })
      );

      expect(message.kind).toBe("text");
      if (message.kind === "text") {
        expect(message.text).toContain("Your Current Product Price List");
        expect(message.text).toContain("1. OPC Cement – UltraTech – 53 Grade");
        expect(message.text).toContain("Current Price: ₹395/bag");
        expect(message.text).toContain("2. M-Sand – P-Sand");
        expect(message.text).toContain("Current Price: ₹1,450/ton");
        expect(message.text).toContain("3. TMT Steel – JSW – Fe500D – 12 mm");
        expect(message.text).toContain("Current Price: ₹64,500/ton");
        expect(message.text).toContain("Reply with product numbers separated by comma (e.g. 2, 3)");
        expect(message.text).toContain("If no prices have changed:\nReply SAME");
      }
    });

    it("handles suppliers with zero active listings gracefully", async () => {
      prisma.product.findMany.mockResolvedValueOnce([]);
      const session = createMockSession();
      const message = await flow.start(session);

      expect(sessionService.resetToMainMenu).toHaveBeenCalledWith("919876543210");
      expect(message.kind).toBe("text");
      if (message.kind === "text") {
        expect(message.text).toContain("You have no active listings right now");
      }
    });
  });

  describe("handle() in AWAITING_PRODUCT_SELECTION", () => {
    const serialMapping: SerialMappingItem[] = [
      { serial: 1, productId: "prod-1", name: "OPC Cement", title: "OPC Cement – UltraTech – 53 Grade", unit: "bag", currentPrice: 395 },
      { serial: 2, productId: "prod-2", name: "M-Sand", title: "M-Sand – P-Sand", unit: "ton", currentPrice: 1450 },
      { serial: 3, productId: "prod-3", name: "TMT Steel", title: "TMT Steel – JSW – Fe500D – 12 mm", unit: "ton", currentPrice: 64500 },
    ];

    it("confirms no price changes when supplier replies SAME", async () => {
      const session = createMockSession({
        context: { serialMapping },
      });

      const message = await flow.handle(session, "SAME");

      expect(sessionService.resetToMainMenu).toHaveBeenCalledWith("919876543210");
      expect(dailyPriceReminder.resolveIfComplete).toHaveBeenCalledWith("supplier-profile-1");
      expect(message.kind).toBe("text");
      if (message.kind === "text") {
        expect(message.text).toContain("Confirmed: all your product prices remain unchanged");
      }
    });

    it("accepts 'NO CHANGE' or 'UNCHANGED' as SAME keyword", async () => {
      const session = createMockSession({
        context: { serialMapping },
      });

      const message = await flow.handle(session, "no change");

      expect(sessionService.resetToMainMenu).toHaveBeenCalledWith("919876543210");
      expect(dailyPriceReminder.resolveIfComplete).toHaveBeenCalledWith("supplier-profile-1");
      if (message.kind === "text") {
        expect(message.text).toContain("Confirmed: all your product prices remain unchanged");
      }
    });

    it("confirms product selection when supplier replies with serial numbers (e.g. '2, 3')", async () => {
      const session = createMockSession({
        context: { serialMapping },
      });

      const message = await flow.handle(session, "2, 3");

      expect(sessionService.update).toHaveBeenCalledWith("919876543210", {
        step: "AWAITING_PRICE_INPUT",
        context: expect.objectContaining({
          selectedSerials: [2, 3],
        }),
      });

      expect(message.kind).toBe("text");
      if (message.kind === "text") {
        expect(message.text).toContain("Selected Products for Price Update:");
        expect(message.text).toContain("2. M-Sand – P-Sand");
        expect(message.text).toContain("Current: ₹1,450/ton");
        expect(message.text).toContain("3. TMT Steel – JSW – Fe500D – 12 mm");
        expect(message.text).toContain("Current: ₹64,500/ton");
        expect(message.text).toContain("Please reply with new prices:");
      }
    });

    it("returns helpful error when supplier provides an invalid serial number", async () => {
      const session = createMockSession({
        context: { serialMapping },
      });

      const message = await flow.handle(session, "99");

      expect(sessionService.incrementInvalid).toHaveBeenCalledWith("919876543210");
      expect(message.kind).toBe("text");
      if (message.kind === "text") {
        expect(message.text).toContain("Please reply with valid product serial numbers (1 to 3)");
      }
    });

    it("supports direct price update shortcut from catalogue view (e.g. '2 - 1520')", async () => {
      const session = createMockSession({
        context: { serialMapping },
      });

      const message = await flow.handle(session, "2 - 1520");

      expect(listingsService.update).toHaveBeenCalledWith(
        "prod-2",
        { price: "1520" },
        expect.objectContaining({ userId: "user-1" })
      );
      expect(audit.record).toHaveBeenCalled();
      expect(sessionService.resetToMainMenu).toHaveBeenCalledWith("919876543210");
      if (message.kind === "text") {
        expect(message.text).toContain("Price Update Successful");
        expect(message.text).toContain("M-Sand – P-Sand: ₹1,450 → ₹1,520/ton");
      }
    });
  });

  describe("handle() in AWAITING_PRICE_INPUT", () => {
    const serialMapping: SerialMappingItem[] = [
      { serial: 1, productId: "prod-1", name: "OPC Cement", title: "OPC Cement – UltraTech – 53 Grade", unit: "bag", currentPrice: 395 },
      { serial: 2, productId: "prod-2", name: "M-Sand", title: "M-Sand – P-Sand", unit: "ton", currentPrice: 1450 },
      { serial: 3, productId: "prod-3", name: "TMT Steel", title: "TMT Steel – JSW – Fe500D – 12 mm", unit: "ton", currentPrice: 64500 },
    ];

    it("updates only explicitly submitted products and sends confirmation receipt noting unchanged products", async () => {
      const session = createMockSession({
        step: "AWAITING_PRICE_INPUT",
        context: {
          serialMapping,
          selectedSerials: [2, 3],
        },
      });

      const message = await flow.handle(session, "2 - 1520, 3 - 64800");

      expect(listingsService.update).toHaveBeenCalledWith(
        "prod-2",
        { price: "1520" },
        expect.any(Object)
      );
      expect(listingsService.update).toHaveBeenCalledWith(
        "prod-3",
        { price: "64800" },
        expect.any(Object)
      );
      // Product 1 must NOT be updated
      expect(listingsService.update).not.toHaveBeenCalledWith("prod-1", expect.any(Object), expect.any(Object));

      expect(dailyPriceReminder.resolveIfComplete).toHaveBeenCalledWith("supplier-profile-1");
      expect(sessionService.resetToMainMenu).toHaveBeenCalledWith("919876543210");

      expect(message.kind).toBe("text");
      if (message.kind === "text") {
        expect(message.text).toContain("Price Update Successful");
        expect(message.text).toContain("Updated Products:");
        expect(message.text).toContain("M-Sand – P-Sand: ₹1,450 → ₹1,520/ton");
        expect(message.text).toContain("TMT Steel – JSW – Fe500D – 12 mm: ₹64,500 → ₹64,800/ton");
        expect(message.text).toContain("Unchanged Products:");
        expect(message.text).toContain("OPC Cement – UltraTech – 53 Grade: ₹395/bag (Unchanged)");
        expect(message.text).toContain("Your prices are now live on Buildohub.");
      }
    });

    it("accepts a bare price number when only 1 product was selected", async () => {
      const session = createMockSession({
        step: "AWAITING_PRICE_INPUT",
        context: {
          serialMapping,
          selectedSerials: [2],
        },
      });

      const message = await flow.handle(session, "1520");

      expect(listingsService.update).toHaveBeenCalledWith(
        "prod-2",
        { price: "1520" },
        expect.any(Object)
      );
      if (message.kind === "text") {
        expect(message.text).toContain("Price Update Successful");
        expect(message.text).toContain("M-Sand – P-Sand: ₹1,450 → ₹1,520/ton");
      }
    });

    it("warns when price input deviates by >80% (soft range check)", async () => {
      const session = createMockSession({
        step: "AWAITING_PRICE_INPUT",
        context: {
          serialMapping,
          selectedSerials: [2],
        },
      });

      // 1450 -> 10000 (>500% deviation)
      const message = await flow.handle(session, "2 - 10000");

      expect(listingsService.update).not.toHaveBeenCalled();
      expect(sessionService.update).toHaveBeenCalledWith("919876543210", {
        step: "CONFIRM_OUT_OF_RANGE",
        context: expect.objectContaining({
          pendingPrices: [{ serial: 2, price: 10000 }],
        }),
      });

      if (message.kind === "text") {
        expect(message.text).toContain("Price check warning");
        expect(message.text).toContain(">80% difference");
        expect(message.text).toContain("Reply CONFIRM to confirm");
      }
    });

    it("cancels price update when supplier sends CANCEL", async () => {
      const session = createMockSession({
        step: "AWAITING_PRICE_INPUT",
        context: {
          serialMapping,
          selectedSerials: [2],
        },
      });

      const message = await flow.handle(session, "CANCEL");

      expect(listingsService.update).not.toHaveBeenCalled();
      expect(sessionService.resetToMainMenu).toHaveBeenCalledWith("919876543210");
      if (message.kind === "text") {
        expect(message.text).toContain("Price update cancelled");
      }
    });
  });

  describe("handle() in CONFIRM_OUT_OF_RANGE", () => {
    const serialMapping: SerialMappingItem[] = [
      { serial: 1, productId: "prod-1", name: "OPC Cement", title: "OPC Cement", unit: "bag", currentPrice: 395 },
      { serial: 2, productId: "prod-2", name: "M-Sand", title: "M-Sand", unit: "ton", currentPrice: 1450 },
    ];

    it("applies the out-of-range price when supplier replies CONFIRM", async () => {
      const session = createMockSession({
        step: "CONFIRM_OUT_OF_RANGE",
        context: {
          serialMapping,
          pendingPrices: [{ serial: 2, price: 10000 }],
        },
      });

      const message = await flow.handle(session, "CONFIRM");

      expect(listingsService.update).toHaveBeenCalledWith(
        "prod-2",
        { price: "10000" },
        expect.any(Object)
      );
      if (message.kind === "text") {
        expect(message.text).toContain("Price Update Successful");
      }
    });

    it("aborts when supplier replies CANCEL", async () => {
      const session = createMockSession({
        step: "CONFIRM_OUT_OF_RANGE",
        context: {
          serialMapping,
          pendingPrices: [{ serial: 2, price: 10000 }],
        },
      });

      const message = await flow.handle(session, "CANCEL");

      expect(listingsService.update).not.toHaveBeenCalled();
      expect(sessionService.resetToMainMenu).toHaveBeenCalledWith("919876543210");
      if (message.kind === "text") {
        expect(message.text).toContain("Price update cancelled");
      }
    });
  });
});

