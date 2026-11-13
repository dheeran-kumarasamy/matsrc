// Unit tests for AdminDashboardService.getSummary — specifically the new
// pendingActionsCount/pendingActions fields backing the Admin layout's
// "N items need action" button (apps/admin/components/admin/
// PendingActionsButton.tsx). Previously that button showed a hardcoded "7"
// regardless of real data; these tests pin down that the count is now a
// real, derived total across every existing admin queue (vendors, KYC,
// disputes, payments, advance payments, supplier invoices).
import { describe, expect, it, vi } from "vitest";
import { AdminDashboardService } from "./dashboard.service";

function buildService(counts: Partial<Record<string, number>> = {}) {
  const defaults = {
    user: 0,
    kycDocument: 0,
    dispute: 0,
    order: 0,
    purchaseOrder: 0,
    paymentVerification: 0,
    advancePayment: 0,
    supplierInvoice: 0,
  };
  const merged = { ...defaults, ...counts };

  const prisma = {
    user: { count: vi.fn().mockResolvedValue(merged.user) },
    kycDocument: { count: vi.fn().mockResolvedValue(merged.kycDocument) },
    dispute: { count: vi.fn().mockResolvedValue(merged.dispute) },
    order: { count: vi.fn().mockResolvedValue(merged.order) },
    purchaseOrder: { count: vi.fn().mockResolvedValue(merged.purchaseOrder) },
    paymentVerification: { count: vi.fn().mockResolvedValue(merged.paymentVerification) },
    advancePayment: { count: vi.fn().mockResolvedValue(merged.advancePayment) },
    supplierInvoice: { count: vi.fn().mockResolvedValue(merged.supplierInvoice) },
  };

  const service = new AdminDashboardService(prisma as any);
  return { service, prisma };
}

describe("AdminDashboardService.getSummary", () => {
  it("returns pendingActionsCount of 0 (never a hardcoded non-zero default) when every queue is empty", async () => {
    const { service } = buildService();
    const summary = await service.getSummary();
    expect(summary.pendingActionsCount).toBe(0);
  });

  it("sums pendingVendors + pendingKyc + openDisputes + pendingPayments + pendingAdvancePayments + pendingSupplierInvoices", async () => {
    const { service } = buildService({
      user: 2,
      kycDocument: 1,
      dispute: 3,
      paymentVerification: 4,
      advancePayment: 5,
      supplierInvoice: 6,
    });
    const summary = await service.getSummary();
    expect(summary.pendingActionsCount).toBe(2 + 1 + 3 + 4 + 5 + 6);
  });

  it("never includes totalOrders/issuedPurchaseOrders in the pendingActionsCount (those are informational metrics, not actionable queues)", async () => {
    const { service } = buildService({ order: 1000, purchaseOrder: 500 });
    const summary = await service.getSummary();
    expect(summary.pendingActionsCount).toBe(0);
  });

  it("returns a pendingActions breakdown with one entry per queue, each carrying its own count and href", async () => {
    const { service } = buildService({ user: 2, kycDocument: 1, dispute: 3 });
    const summary = await service.getSummary();

    const vendorsEntry = summary.pendingActions.find((item) => item.key === "vendors");
    expect(vendorsEntry).toEqual({ key: "vendors", label: "Pending Vendors", count: 2, href: "/vendors" });

    const kycEntry = summary.pendingActions.find((item) => item.key === "kyc");
    expect(kycEntry?.count).toBe(1);
    expect(kycEntry?.href).toBe("/kyc");

    const disputesEntry = summary.pendingActions.find((item) => item.key === "disputes");
    expect(disputesEntry?.count).toBe(3);
    expect(disputesEntry?.href).toBe("/disputes");
  });

  it("scopes each count to the correct PENDING/open status filter, never counting approved/rejected/resolved rows", async () => {
    const { service, prisma } = buildService();
    await service.getSummary();

    expect(prisma.paymentVerification.count).toHaveBeenCalledWith({ where: { status: "PENDING" } });
    expect(prisma.advancePayment.count).toHaveBeenCalledWith({ where: { status: "PENDING" } });
    expect(prisma.supplierInvoice.count).toHaveBeenCalledWith({ where: { status: "PENDING_REVIEW" } });
    expect(prisma.kycDocument.count).toHaveBeenCalledWith({ where: { verified: false } });
    expect(prisma.dispute.count).toHaveBeenCalledWith({
      where: { status: { in: ["OPEN", "UNDER_REVIEW", "ESCALATED"] } },
    });
  });
});
