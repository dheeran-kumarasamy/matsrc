import { describe, expect, it, vi } from "vitest";
import { SupplierDailyPriceReplyFlow } from "./supplier-daily-price-reply.flow";

const BUSINESS_DATE = "2026-10-01";
const SUPPLIER_ID = "supplier-1";
const DEDUPE_KEY = `SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:${SUPPLIER_ID}:${BUSINESS_DATE}`;

type NotificationEventRow = { id: string; dedupeKey: string; status: string; payload: any };

/**
 * In-memory NotificationEvent store that faithfully emulates the two Prisma
 * query shapes this flow relies on for its preview compare-and-swap:
 *  - findUnique by `id` or by `dedupeKey`.
 *  - updateMany with a `payload: { path: [...], equals }` JSON-path filter
 *    (the actual optimistic-concurrency guard used by handleConfirm/
 *    handleCancel) — only applies `data` when the value at that path
 *    currently matches `equals`, otherwise returns `{ count: 0 }`.
 */
function makeNotificationEventStore(initial: NotificationEventRow[]) {
  const rows = new Map<string, NotificationEventRow>(initial.map((row) => [row.id, { ...row }]));

  function readPath(obj: any, path: string[]): unknown {
    let current = obj;
    for (const key of path) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    return current;
  }

  const findUnique = vi.fn((args: any) => {
    if (args.where.id) {
      const row = rows.get(args.where.id);
      return Promise.resolve(row ? { ...row } : null);
    }
    if (args.where.dedupeKey) {
      const row = [...rows.values()].find((r) => r.dedupeKey === args.where.dedupeKey);
      return Promise.resolve(row ? { ...row } : null);
    }
    return Promise.resolve(null);
  });

  const update = vi.fn((args: any) => {
    const row = rows.get(args.where.id);
    if (!row) return Promise.reject(new Error("not found"));
    const updated = { ...row, ...args.data };
    rows.set(args.where.id, updated);
    return Promise.resolve(updated);
  });

  const updateMany = vi.fn((args: any) => {
    const row = rows.get(args.where.id);
    if (!row) return Promise.resolve({ count: 0 });

    const jsonFilter = args.where.payload;
    if (jsonFilter?.path) {
      const current = readPath(row.payload, jsonFilter.path);
      if (current !== jsonFilter.equals) {
        return Promise.resolve({ count: 0 });
      }
    }

    rows.set(args.where.id, { ...row, ...args.data });
    return Promise.resolve({ count: 1 });
  });

  return { rows, findUnique, update, updateMany };
}

function makeHarness(overrides: {
  notificationEvent?: NotificationEventRow | null;
  products?: Array<{ id: string; name: string; unit?: string; basePrice?: string | number }>;
  resolveByVerifiedNumber?: any;
} = {}) {
  const defaultEvent: NotificationEventRow = {
    id: "evt-1",
    dedupeKey: DEDUPE_KEY,
    status: "created",
    payload: { supplierId: SUPPLIER_ID, businessDate: BUSINESS_DATE, missingProducts: ["TMT 10mm", "TMT 12mm", "M-Sand"] },
  };
  const eventStore = makeNotificationEventStore(
    overrides.notificationEvent === null ? [] : [overrides.notificationEvent ?? defaultEvent]
  );

  const products = overrides.products ?? [
    { id: "p1", name: "TMT 10mm", unit: "MT", basePrice: "55000" },
    { id: "p2", name: "TMT 12mm", unit: "MT", basePrice: "56500" },
    { id: "p3", name: "M-Sand", unit: "MT", basePrice: "2000" },
  ];

  const auditRecords: any[] = [];

  const prisma = {
    notificationEvent: {
      findUnique: eventStore.findUnique,
      update: eventStore.update,
      updateMany: eventStore.updateMany,
    },
    product: {
      findMany: vi.fn().mockResolvedValue(products),
    },
    auditLog: {
      findFirst: vi.fn().mockImplementation((args: any) => {
        const key = args.where.metadata?.equals;
        const match = auditRecords.find(
          (r) => r.entityId === args.where.entityId && r.action === args.where.action && r.metadata?.idempotencyKey === key
        );
        return Promise.resolve(match ? { id: "audit-existing" } : null);
      }),
    },
  };

  const authService = {
    resolveByVerifiedNumber:
      overrides.resolveByVerifiedNumber ??
      vi.fn().mockResolvedValue({
        userId: "user-1",
        supplierProfileId: SUPPLIER_ID,
        email: "supplier@example.com",
        name: "Test Supplier",
        language: "en",
      }),
  };

  const sessionService = { withIdempotency: vi.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()) };

  const listingsService = { update: vi.fn().mockResolvedValue({ id: "p1", name: "TMT 10mm", unit: "MT" }) };

  const completeness = {
    getBusinessDateKey: vi.fn().mockReturnValue(BUSINESS_DATE),
    evaluateSupplier: vi.fn().mockResolvedValue({ missingProducts: [] }),
  };

  const dailyPriceReminder = { resolveIfComplete: vi.fn().mockResolvedValue(undefined) };

  const audit = {
    record: vi.fn().mockImplementation((params: any) => {
      auditRecords.push(params);
      return Promise.resolve(undefined);
    }),
  };

  const flow = new SupplierDailyPriceReplyFlow(
    prisma as any,
    authService as any,
    sessionService as any,
    listingsService as any,
    completeness as any,
    dailyPriceReminder as any,
    audit as any
  );

  return { flow, prisma, eventStore, authService, sessionService, listingsService, completeness, dailyPriceReminder, audit, auditRecords };
}

async function previewThenConfirm(flow: SupplierDailyPriceReplyFlow, text: string) {
  await flow.tryHandle("919876543210", text, undefined);
  return flow.tryHandle("919876543210", "CONFIRM", undefined);
}

describe("SupplierDailyPriceReplyFlow", () => {
  describe("Identity and routing", () => {
    it("resolves a known supplier WhatsApp number and returns a preview (not null)", async () => {
      const { flow, authService } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56000", undefined);

      expect(authService.resolveByVerifiedNumber).toHaveBeenCalledWith("919876543210");
      expect(result).not.toBeNull();
    });

    it("an unknown number never applies a price update and responds with null (safe fallthrough)", async () => {
      const { flow, listingsService } = makeHarness({ resolveByVerifiedNumber: vi.fn().mockResolvedValue(null) });

      const result = await flow.tryHandle("919999999999", "TMT 10mm: 56000", undefined);

      expect(result).toBeNull();
      expect(listingsService.update).not.toHaveBeenCalled();
    });

    it("returns null (falls through to normal menu handling) for ordinary conversational text, without ever calling auth", async () => {
      const { flow, authService } = makeHarness();

      const result = await flow.tryHandle("919876543210", "hi there", undefined);

      expect(result).toBeNull();
      expect(authService.resolveByVerifiedNumber).not.toHaveBeenCalled();
    });

    it("no active session (no NotificationEvent) never applies anything", async () => {
      const { flow, listingsService } = makeHarness({ notificationEvent: null });

      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56000", undefined);

      expect(result).toBeNull();
      expect(listingsService.update).not.toHaveBeenCalled();
    });

    it("an already-resolved session never applies anything", async () => {
      const { flow, listingsService } = makeHarness({
        notificationEvent: { id: "evt-1", dedupeKey: DEDUPE_KEY, status: "resolved", payload: {} },
      });

      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56000", undefined);

      expect(result).toBeNull();
      expect(listingsService.update).not.toHaveBeenCalled();
    });
  });

  describe("Current-price response and parsing", () => {
    it("shows accurate current base prices and units for missing products on a malformed/ambiguous reply", async () => {
      const { flow } = makeHarness();
      const result = await flow.tryHandle("919876543210", "Unknown Material: 5000", undefined);

      expect((result as any).text).toContain("TMT 10mm — ₹55000 / MT");
      expect((result as any).text).toContain("TMT 12mm — ₹56500 / MT");
      expect((result as any).text).toContain("M-Sand — ₹2000 / MT");
    });

    it("clearly flags a product with no usable current price", async () => {
      const { flow } = makeHarness({ products: [{ id: "p1", name: "TMT 10mm", unit: "MT", basePrice: "0" }] });
      const result = await flow.tryHandle("919876543210", "Unknown: 5000", undefined);

      expect((result as any).text).toContain("TMT 10mm — no valid current price on file");
    });

    it("parses Product Name: Price", async () => {
      const { flow } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56500", undefined);
      expect((result as any).text).toContain("TMT 10mm");
      expect((result as any).text).toContain("56500");
    });

    it("parses Product Name - Price", async () => {
      const { flow } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm - 56500", undefined);
      expect((result as any).text).toContain("56500");
    });

    it("SAME is case-insensitive and whitespace-tolerant", async () => {
      const { flow } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm:   same  ", undefined);
      expect((result as any).text).toContain("Confirmed unchanged");
      expect((result as any).text).toContain("SAME");
    });

    it("parses comma-separated thousands prices", async () => {
      const { flow } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56,500", undefined);
      expect((result as any).text).toContain("56500");
    });

    it("rejects invalid (non-numeric) price without creating a preview that could be confirmed", async () => {
      const { flow, listingsService } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: abc", undefined);

      expect((result as any).text).toContain("invalid price");
      const confirmResult = await flow.tryHandle("919876543210", "CONFIRM", undefined);
      expect((confirmResult as any).text).toContain("No pending preview");
      expect(listingsService.update).not.toHaveBeenCalled();
    });

    it("rejects zero and negative prices", async () => {
      const { flow } = makeHarness();
      const zero = await flow.tryHandle("919876543210", "TMT 10mm: 0", undefined);
      const negative = await flow.tryHandle("919876543210", "TMT 10mm: -500", undefined);
      expect((zero as any).text).toContain("invalid price");
      expect((negative as any).text).toContain("invalid price");
    });

    it("rejects a price that deviates more than 80% from the current price", async () => {
      const { flow } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: 500000", undefined);
      expect((result as any).text).toContain("deviates more than 80%");
    });

    it("tier prices (PricingTier) are never read or modified — product.findMany never selects pricingTiers", async () => {
      const { flow, prisma } = makeHarness();
      await flow.tryHandle("919876543210", "TMT 10mm: 56500", undefined);

      const callArgs = (prisma.product.findMany as any).mock.calls[0][0];
      expect(callArgs.select).not.toHaveProperty("pricingTiers");
    });
  });

  describe("Duplicate/ambiguous product names", () => {
    it("rejects a duplicate normalized product name within the same reply without applying either line", async () => {
      const { flow, listingsService } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56000\nTMT 10mm: 57000", undefined);

      expect((result as any).text).toContain("appears more than once");
      expect(listingsService.update).not.toHaveBeenCalled();
    });

    it("rejects an ambiguous product name matching more than one active listing, with actionable detail, never picking the first result", async () => {
      const { flow, listingsService } = makeHarness({
        products: [
          { id: "p1", name: "TMT Bar", unit: "MT", basePrice: "50000" },
          { id: "p2", name: "TMT Bar", unit: "MT", basePrice: "52000" },
        ],
      });

      const result = await flow.tryHandle("919876543210", "TMT Bar: 51000", undefined);

      expect((result as any).text).toContain("matches 2 of your active listings with the same name");
      expect(listingsService.update).not.toHaveBeenCalled();
    });
  });

  describe("Unknown product", () => {
    it("rejects an unknown product name without modifying any record", async () => {
      const { flow, listingsService } = makeHarness();
      const result = await flow.tryHandle("919876543210", "Unknown Material: 5000", undefined);

      expect(listingsService.update).not.toHaveBeenCalled();
      expect((result as any).text).toContain("not part of your active listings");
      expect((result as any).text).toContain("Unknown Material");
    });
  });

  describe("Preview and confirmation lifecycle", () => {
    it("a valid reply creates a preview WITHOUT writing price changes, snapshots, or SAME audit confirmations", async () => {
      const { flow, listingsService, audit, eventStore } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56500\nTMT 12mm: SAME", undefined);

      expect((result as any).text).toContain("preview");
      expect((result as any).text).toContain("CONFIRM");
      expect(listingsService.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(eventStore.rows.get("evt-1")!.payload.pendingPreview).toBeTruthy();
    });

    it("the preview distinguishes CHANGE from SAME lines", async () => {
      const { flow } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56500\nTMT 12mm: SAME", undefined);

      expect((result as any).text).toContain("55000 → ₹56500");
      expect((result as any).text).toContain("Confirmed unchanged");
      expect((result as any).text).toContain("TMT 12mm: ₹56500");
    });

    it("CONFIRM applies the exact previewed CHANGE via ListingsService.update and the exact previewed SAME via audit only", async () => {
      const { flow, listingsService, auditRecords } = makeHarness();
      const confirmResult = await previewThenConfirm(flow, "TMT 10mm: 56500\nTMT 12mm: SAME");

      expect(listingsService.update).toHaveBeenCalledTimes(1);
      expect(listingsService.update).toHaveBeenCalledWith(
        "p1",
        { price: "56500" },
        expect.objectContaining({ userId: "user-1" })
      );
      expect(auditRecords.some((r) => r.action === "PRICE_CONFIRMED_UNCHANGED" && r.entityId === "p2")).toBe(true);
      expect((confirmResult as any).text).toContain("Prices updated");
      expect((confirmResult as any).text).toContain("Confirmed unchanged");
    });

    it("CANCEL creates no price or snapshot writes and no accepted SAME audit entries", async () => {
      const { flow, listingsService, audit } = makeHarness();
      await flow.tryHandle("919876543210", "TMT 10mm: 56500", undefined);
      const cancelResult = await flow.tryHandle("919876543210", "CANCEL", undefined);

      expect((cancelResult as any).text).toContain("cancelled");
      expect(listingsService.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("repeated CANCEL is always harmless", async () => {
      const { flow } = makeHarness();
      await flow.tryHandle("919876543210", "TMT 10mm: 56500", undefined);
      await flow.tryHandle("919876543210", "CANCEL", undefined);
      const secondCancel = await flow.tryHandle("919876543210", "CANCEL", undefined);

      expect((secondCancel as any).text).toContain("Nothing to cancel");
    });

    it("repeated CONFIRM after a successful confirm is safe and never double-applies", async () => {
      const { flow, listingsService } = makeHarness();
      await previewThenConfirm(flow, "TMT 10mm: 56500");
      const secondConfirm = await flow.tryHandle("919876543210", "CONFIRM", undefined);

      expect(listingsService.update).toHaveBeenCalledTimes(1);
      expect((secondConfirm as any).text).toContain("No pending preview");
    });

    it("CONFIRM with no pending preview at all returns a safe, clear message", async () => {
      const { flow, listingsService } = makeHarness();
      const result = await flow.tryHandle("919876543210", "CONFIRM", undefined);

      expect((result as any).text).toContain("No pending preview");
      expect(listingsService.update).not.toHaveBeenCalled();
    });

    it("a changed current price between preview and confirmation invalidates the affected preview (nothing applied)", async () => {
      const { flow, listingsService, prisma } = makeHarness();
      await flow.tryHandle("919876543210", "TMT 10mm: 56500", undefined);

      // Simulate a portal edit that changed p1's price after the preview was staged.
      (prisma.product.findMany as any).mockResolvedValueOnce([
        { id: "p1", name: "TMT 10mm", unit: "MT", basePrice: "60000" },
      ]);

      const confirmResult = await flow.tryHandle("919876543210", "CONFIRM", undefined);

      expect(listingsService.update).not.toHaveBeenCalled();
      expect((confirmResult as any).text).toContain("changed since this preview was created");
    });

    it("a deactivated/transferred product between preview and confirmation is rejected safely", async () => {
      const { flow, listingsService, prisma } = makeHarness();
      await flow.tryHandle("919876543210", "TMT 10mm: 56500", undefined);

      // Simulate the product becoming inactive/no longer owned by this supplier.
      (prisma.product.findMany as any).mockResolvedValueOnce([]);

      const confirmResult = await flow.tryHandle("919876543210", "CONFIRM", undefined);

      expect(listingsService.update).not.toHaveBeenCalled();
      expect((confirmResult as any).text).toContain("no longer an active listing");
    });
  });

  describe("Idempotency and concurrency", () => {
    it("duplicate/concurrent CONFIRM messages cannot apply price changes twice (atomic claim)", async () => {
      const { flow, listingsService, eventStore } = makeHarness();
      await flow.tryHandle("919876543210", "TMT 10mm: 56500", undefined);

      // Simulate two concurrent CONFIRM requests racing — only the first
      // updateMany call (matching the still-current previewToken) should
      // actually claim and apply; the second must see count: 0.
      const [first, second] = await Promise.all([
        flow.tryHandle("919876543210", "CONFIRM", undefined),
        flow.tryHandle("919876543210", "CONFIRM", undefined),
      ]);

      expect(listingsService.update).toHaveBeenCalledTimes(1);
      const texts = [first, second].map((r) => (r as any).text);
      expect(texts.some((t) => t.includes("Prices updated"))).toBe(true);
    });

    it("replayed SAME confirmations cannot create duplicate audit entries", async () => {
      const { flow, auditRecords } = makeHarness();
      await previewThenConfirm(flow, "TMT 10mm: SAME");

      const sameAuditCount = auditRecords.filter((r) => r.action === "PRICE_CONFIRMED_UNCHANGED" && r.entityId === "p1").length;
      expect(sameAuditCount).toBe(1);
    });

    it("retrying a completed operation does not generate duplicate price updates", async () => {
      const { flow, listingsService } = makeHarness();
      await previewThenConfirm(flow, "TMT 10mm: 56500");
      // A stray re-delivery of the same CONFIRM text after completion.
      await flow.tryHandle("919876543210", "CONFIRM", undefined);

      expect(listingsService.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("Identity and ownership", () => {
    it("ownership is revalidated at confirmation time — product.findMany is scoped to this supplier", async () => {
      const { flow, prisma } = makeHarness();
      await previewThenConfirm(flow, "TMT 10mm: 56500");

      const confirmTimeCall = (prisma.product.findMany as any).mock.calls[1][0];
      expect(confirmTimeCall.where.supplierId).toBe(SUPPLIER_ID);
      expect(confirmTimeCall.where.isActive).toBe(true);
    });

    it("a verified supplier can only ever see/update their own active listings (scoped query)", async () => {
      const { flow, prisma } = makeHarness();
      await flow.tryHandle("919876543210", "TMT 10mm: 56500", undefined);

      const callArgs = (prisma.product.findMany as any).mock.calls[0][0];
      expect(callArgs.where.supplierId).toBe(SUPPLIER_ID);
    });
  });

  describe("SAME-specific behavior", () => {
    it("a valid SAME is previewed but has no effect before confirmation", async () => {
      const { flow, listingsService, audit } = makeHarness();
      await flow.tryHandle("919876543210", "TMT 10mm: SAME", undefined);

      expect(listingsService.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("SAME without a valid current base price is rejected", async () => {
      const { flow } = makeHarness({ products: [{ id: "p1", name: "TMT 10mm", unit: "MT", basePrice: "0" }] });
      const result = await flow.tryHandle("919876543210", "TMT 10mm: SAME", undefined);

      expect((result as any).text).toContain("no valid current price on file");
    });

    it("duplicate SAME lines for the same product are handled deterministically (rejected as duplicate line)", async () => {
      const { flow, listingsService } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: SAME\nTMT 10mm: SAME", undefined);

      expect((result as any).text).toContain("appears more than once");
      expect(listingsService.update).not.toHaveBeenCalled();
    });
  });

  describe("Daily completeness integration", () => {
    it("resolves today's reminder once every required product is updated or confirmed unchanged", async () => {
      const { flow, completeness, dailyPriceReminder } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({ missingProducts: [] });

      await previewThenConfirm(flow, "TMT 10mm: 56500\nTMT 12mm: SAME\nM-Sand: SAME");

      expect(dailyPriceReminder.resolveIfComplete).toHaveBeenCalledWith(SUPPLIER_ID);
    });

    it("does not resolve the reminder while products are still missing", async () => {
      const { flow, completeness, dailyPriceReminder } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({ missingProducts: [{ id: "p3", name: "M-Sand" }] });

      await previewThenConfirm(flow, "TMT 10mm: 56500");

      expect(dailyPriceReminder.resolveIfComplete).not.toHaveBeenCalled();
    });
  });
});
