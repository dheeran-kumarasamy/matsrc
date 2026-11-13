import { Injectable } from "@nestjs/common";
import {
  AdvancePaymentStatus,
  DisputeStatus,
  KycStatus,
  PaymentVerificationStatus,
  PurchaseOrderStatus,
  Role,
  SupplierInvoiceStatus,
} from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const [
      pendingVendors,
      pendingKyc,
      openDisputes,
      totalOrders,
      issuedPurchaseOrders,
      pendingPayments,
      pendingAdvancePayments,
      pendingSupplierInvoices,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.SUPPLIER, kycStatus: KycStatus.PENDING } }),
      this.prisma.kycDocument.count({ where: { verified: false } }),
      this.prisma.dispute.count({ where: { status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW, DisputeStatus.ESCALATED] } } }),
      this.prisma.order.count(),
      this.prisma.purchaseOrder.count({
        where: {
          status: {
            in: [PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.ACKNOWLEDGED, PurchaseOrderStatus.FULFILLED],
          },
        },
      }),
      // Bank-transfer payment proofs awaiting Admin verification — see
      // PaymentsController.findPending() / the Payment Verification queue.
      this.prisma.paymentVerification.count({ where: { status: PaymentVerificationStatus.PENDING } }),
      // Buildohub Advance Payment screenshots awaiting Admin
      // approval/rejection — see AdvancePaymentsController.findAll().
      this.prisma.advancePayment.count({ where: { status: AdvancePaymentStatus.PENDING } }),
      // Supplier-uploaded invoices awaiting Admin review/confirmation — see
      // SupplierInvoicesController.findAll().
      this.prisma.supplierInvoice.count({ where: { status: SupplierInvoiceStatus.PENDING_REVIEW } }),
    ]);

    // "Pending Actions" — the single, real count backing the Admin layout's
    // clickable "N items need action" button (see
    // apps/admin/components/admin/PendingActionsButton.tsx). Every entry
    // here is an item a real Admin action can resolve (approve/reject/
    // review), each with its own existing queue page — never a static or
    // guessed figure. Each category is reported individually too, so the
    // dropdown can show a breakdown rather than just a single opaque total.
    const pendingActions = [
      { key: "vendors" as const, label: "Pending Vendors", count: pendingVendors, href: "/vendors" },
      { key: "kyc" as const, label: "KYC Docs Pending", count: pendingKyc, href: "/kyc" },
      { key: "disputes" as const, label: "Open Disputes", count: openDisputes, href: "/disputes" },
      { key: "payments" as const, label: "Payments Awaiting Verification", count: pendingPayments, href: "/payments" },
      {
        key: "advance-payments" as const,
        label: "Advance Payments Awaiting Approval",
        count: pendingAdvancePayments,
        href: "/advance-payments",
      },
      {
        key: "supplier-invoices" as const,
        label: "Supplier Invoices Awaiting Review",
        count: pendingSupplierInvoices,
        href: "/supplier-invoices",
      },
    ];

    const pendingActionsCount = pendingActions.reduce((sum, item) => sum + item.count, 0);

    return {
      pendingVendors,
      pendingKyc,
      openDisputes,
      totalOrders,
      issuedPurchaseOrders,
      pendingPayments,
      pendingAdvancePayments,
      pendingSupplierInvoices,
      pendingActionsCount,
      pendingActions,
    };
  }
}
