// packages/db/lib/best-price-selection.ts
//
// Shared, framework-agnostic Best-Price Selection & Enquiry Auto-Finalization.
//
// When suppliers submit quotations for an enquiry (RFQ), this evaluates
// whether enough quotes have arrived (minQuotes or response deadline reached)
// and every line item has at least one valid quotation. If eligible:
//   1. Chooses the winning quote per line item (lowest price, earliest delivery).
//   2. Resolves admin-configurable markup per product.
//   3. Resolves GST confirmation snapshot (order-confirmation-snapshot.ts).
//   4. Concurrency-safely transitions Order from PLACED -> PROCESSING inside
//      a Prisma transaction (guarded by quoteSelectionCompletedAt: null).
//   5. Generates buyer-facing Order Number (OD/YYMM/SSSSS) if null.
//   6. Updates OrderItem and SupplierQuote rows with buyer pricing and frozen snapshots.
//   7. Records OrderTracking ("Supplier marked order as Processing").
//   8. Dispatches customer_order_status and payment_required WhatsApp/in-app notifications.
//   9. Records PriceSnapshot price-discovery rows.
//
// Used by both the Next.js Supplier Portal (apps/supplier/lib/supplier-data.ts)
// and the NestJS API backend (apps/api/src/supplier/rfqs/best-price-selection.service.ts).

import { OrderStatus } from "@prisma/client";
import {
  resolveOrderConfirmationSnapshot,
  assertFullOrderSnapshotIntegrity,
  ConcurrentConfirmationLostError,
  type OrderConfirmationSnapshot,
} from "./order-confirmation-snapshot";
import { generateOrderNumber } from "./business-number";
import { resolveMarkupForProduct } from "./markup-calculation";
import { closeCompetingSuppliersForOrder } from "./competing-supplier-closure";
import { notifyCustomerOrderStatusChanged } from "./customer-order-status-notification";
import { notifyPaymentRequired } from "./payment-required-notification";

export type QuoteCandidate = {
  supplierId: string;
  unitPrice: number;
  leadTimeDays?: number | null;
  createdAt: Date;
};

export type BestLineItemSelection = {
  lineItemId: string;
  supplierId: string;
  unitPrice: number;
  supplierUnitPrice: number;
  markupPercent: number;
  markupAmount: number;
  currency: string;
  leadTimeDays?: number | null;
};

export function selectLowestValidQuote(candidates: QuoteCandidate[]): QuoteCandidate {
  if (!candidates.length) {
    throw new Error("No candidates available for best-price selection");
  }

  const sorted = [...candidates].sort((left, right) => {
    if (left.unitPrice !== right.unitPrice) {
      return left.unitPrice - right.unitPrice;
    }

    const leftLead = left.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
    const rightLead = right.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
    if (leftLead !== rightLead) {
      return leftLead - rightLead;
    }

    const byTimestamp = left.createdAt.getTime() - right.createdAt.getTime();
    if (byTimestamp !== 0) {
      return byTimestamp;
    }

    return left.supplierId.localeCompare(right.supplierId);
  });

  return sorted[0];
}

export type BestPriceSelectionResult = {
  enquiryId: string;
  selectedSupplierId: string | null;
  selectedSupplierName: string | null;
  bestPriceTotal: number;
  tentativeDeliveryDate: Date;
  lineItems: Array<BestLineItemSelection & { quantity: number; materialName: string }>;
  finalized: boolean;
  snapshot?: OrderConfirmationSnapshot | null;
};

export type FinalizeEnquiryOptions = {
  minQuotes?: number;
  deadlineMinutes?: number;
  waitUntil?: (promise: Promise<unknown>) => void;
  onLog?: (message: string) => void;
};

export async function finalizeEnquiryBestPriceIfEligible(
  prisma: any,
  enquiryId: string,
  options?: FinalizeEnquiryOptions
): Promise<BestPriceSelectionResult | null> {
  const onLog = options?.onLog ?? (() => undefined);
  const schedule = options?.waitUntil ?? ((p: Promise<unknown>) => void p.catch(() => undefined));

  const order = await prisma.order.findUnique({
    where: { id: enquiryId },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!order) {
    return null;
  }

  if (order.quoteSelectionCompletedAt) {
    // Already finalized: assert full snapshot integrity and return
    assertFullOrderSnapshotIntegrity(
      enquiryId,
      {
        totalAmount: Number(order.totalAmount),
        taxAmount: order.taxAmount !== null ? Number(order.taxAmount) : null,
        finalPayableAmount: order.finalPayableAmount !== null ? Number(order.finalPayableAmount) : null,
        advancePercent: order.advancePercent !== null ? Number(order.advancePercent) : null,
        requiredAdvanceAmount: order.requiredAdvanceAmount !== null ? Number(order.requiredAdvanceAmount) : null,
      },
      order.items.map((item: any) => ({
        id: item.id,
        taxRatePercent: item.taxRatePercent !== null ? Number(item.taxRatePercent) : null,
        taxAmount: item.taxAmount !== null ? Number(item.taxAmount) : null,
      }))
    );

    return {
      enquiryId,
      selectedSupplierId: order.selectedSupplierId,
      selectedSupplierName: null,
      bestPriceTotal: Number(order.bestPriceTotal ?? order.totalAmount ?? 0),
      tentativeDeliveryDate: order.tentativeDeliveryDate ?? order.deliveryDate ?? new Date(),
      lineItems: [],
      finalized: false,
    };
  }

  const quotes = await prisma.supplierQuote.findMany({
    where: { enquiryId },
    orderBy: { createdAt: "desc" },
  });

  if (!quotes.length || !order.items.length) {
    return null;
  }

  const uniqueSuppliers = new Set(quotes.map((q: any) => q.supplierId));
  const minQuotes = options?.minQuotes ?? (Number(process.env.MIN_QUOTES_FOR_SELECTION) || 1);
  const deadlineMinutes = options?.deadlineMinutes ?? (Number(process.env.QUOTE_DEADLINE_MINUTES) || 0);

  const firstResponseAt = quotes.reduce(
    (earliest: Date, q: any) => (q.createdAt < earliest ? q.createdAt : earliest),
    quotes[0].createdAt
  );
  const deadlineReached =
    deadlineMinutes > 0 && Date.now() >= firstResponseAt.getTime() + deadlineMinutes * 60 * 1000;

  if (!deadlineReached && uniqueSuppliers.size < minQuotes) {
    return null;
  }

  // Every line item on this enquiry must have at least one quote
  for (const item of order.items) {
    const lineQuotes = quotes.filter((q: any) => q.lineItemId === item.id);
    if (!lineQuotes.length) {
      return null;
    }
  }

  const winningLines: Array<BestLineItemSelection & { quantity: number; materialName: string }> = [];

  for (const item of order.items) {
    const lineQuotes = quotes.filter((q: any) => q.lineItemId === item.id);
    const winner = selectLowestValidQuote(
      lineQuotes.map((q: any) => ({
        supplierId: q.supplierId,
        unitPrice: Number(q.unitPrice),
        leadTimeDays: q.leadTimeDays,
        createdAt: q.createdAt,
      }))
    );

    const markup = await resolveMarkupForProduct(prisma, {
      productId: item.productId,
      categoryId: item.product.categoryId,
      supplierUnitPrice: winner.unitPrice,
    }).catch(() => null);

    const resolved =
      markup ?? { supplierUnitPrice: winner.unitPrice, buyerUnitPrice: winner.unitPrice, markupPercent: 0, markupAmount: 0 };

    winningLines.push({
      lineItemId: item.id,
      supplierId: winner.supplierId,
      unitPrice: resolved.buyerUnitPrice,
      supplierUnitPrice: resolved.supplierUnitPrice,
      markupPercent: resolved.markupPercent,
      markupAmount: resolved.markupAmount,
      currency: lineQuotes[0].currency,
      leadTimeDays: winner.leadTimeDays,
      quantity: item.quantity,
      materialName: item.product.name,
    });
  }

  const bestPriceTotal = winningLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const distinctWinningSuppliers = Array.from(new Set(winningLines.map((line) => line.supplierId)));
  const selectedSupplierId = distinctWinningSuppliers.length === 1 ? distinctWinningSuppliers[0] : null;

  const selectedSupplierProfile = selectedSupplierId
    ? await prisma.supplierProfile.findUnique({ where: { id: selectedSupplierId } })
    : null;

  const maxLeadDays = Math.max(
    0,
    ...winningLines.map((l) => (typeof l.leadTimeDays === "number" ? l.leadTimeDays : 0))
  );
  const tentativeDeliveryDate =
    maxLeadDays > 0
      ? new Date(order.createdAt.getTime() + maxLeadDays * 24 * 60 * 60 * 1000)
      : order.deliveryDate ?? new Date();

  const previousStatus = order.status;
  const newStatus = previousStatus === OrderStatus.PLACED ? OrderStatus.PROCESSING : previousStatus;

  // Resolve GST confirmation snapshot
  const snapshotResolution = await resolveOrderConfirmationSnapshot(
    prisma,
    winningLines.map((line) => ({
      lineItemId: line.lineItemId,
      productId: order.items.find((item: any) => item.id === line.lineItemId)!.productId,
      categoryId: order.items.find((item: any) => item.id === line.lineItemId)!.product.categoryId,
      supplierUnitPrice: line.supplierUnitPrice,
      markupPercent: line.markupPercent,
      quantity: line.quantity,
    }))
  );

  if (!snapshotResolution.ok) {
    onLog(`Cannot finalize enquiry ${enquiryId}: GST resolution errors: ${JSON.stringify(snapshotResolution.errors)}`);
    throw new Error(
      `Cannot confirm this enquiry: one or more products have no valid effective GST rate configured. ${JSON.stringify(
        snapshotResolution.errors
      )}`
    );
  }

  const { snapshot } = snapshotResolution;
  const snapshotByLineItemId = new Map(snapshot.lines.map((line) => [line.lineItemId, line]));

  try {
    await prisma.$transaction(async (tx: any) => {
      // Concurrency guard
      const claimed = await tx.order.updateMany({
        where: { id: enquiryId, quoteSelectionCompletedAt: null },
        data: {
          status: newStatus,
          selectedSupplierId,
          bestPriceTotal,
          totalAmount: bestPriceTotal,
          tentativeDeliveryDate,
          quoteSelectionCompletedAt: new Date(),
          taxAmount: snapshot.taxAmount,
          finalPayableAmount: snapshot.finalPayableAmount,
          advancePercent: snapshot.advancePercent,
          requiredAdvanceAmount: snapshot.requiredAdvanceAmount,
        },
      });

      if (claimed.count === 0) {
        throw new ConcurrentConfirmationLostError(enquiryId);
      }

      // Generate orderNumber if not already assigned
      const existingOrder = await tx.order.findUnique({
        where: { id: enquiryId },
        select: { orderNumber: true },
      });
      if (!existingOrder?.orderNumber && newStatus === "PROCESSING") {
        const orderNumber = await generateOrderNumber(tx);
        await tx.order.update({
          where: { id: enquiryId },
          data: { orderNumber },
        });
      }

      for (const line of winningLines) {
        const lineSnapshot = snapshotByLineItemId.get(line.lineItemId);
        await tx.orderItem.update({
          where: { id: line.lineItemId },
          data: {
            unitPrice: line.unitPrice,
            supplierId: line.supplierId,
            supplierUnitPrice: line.supplierUnitPrice,
            markupPercent: line.markupPercent,
            markupAmount: line.markupAmount,
            taxRatePercent: lineSnapshot?.taxRatePercent ?? null,
            taxAmount: lineSnapshot?.taxAmount ?? null,
          },
        });

        await tx.supplierQuote.updateMany({
          where: { lineItemId: line.lineItemId, supplierId: line.supplierId },
          data: {
            buyerUnitPrice: line.unitPrice,
            markupPercent: line.markupPercent,
            markupAmount: line.markupAmount,
          },
        });
      }

      if (selectedSupplierId) {
        await closeCompetingSuppliersForOrder(tx, {
          orderId: enquiryId,
          winningSupplierId: selectedSupplierId,
          enquiryId: order.enquiryId,
        });
      }
    });
  } catch (error) {
    if (error instanceof ConcurrentConfirmationLostError) {
      onLog(`Lost confirmation race for enquiry ${enquiryId} to concurrent request`);
      const finalized = await prisma.order.findUnique({
        where: { id: enquiryId },
        include: { items: { select: { id: true, taxRatePercent: true, taxAmount: true } } },
      });
      if (!finalized) throw error;
      assertFullOrderSnapshotIntegrity(
        enquiryId,
        {
          totalAmount: Number(finalized.totalAmount),
          taxAmount: finalized.taxAmount !== null ? Number(finalized.taxAmount) : null,
          finalPayableAmount: finalized.finalPayableAmount !== null ? Number(finalized.finalPayableAmount) : null,
          advancePercent: finalized.advancePercent !== null ? Number(finalized.advancePercent) : null,
          requiredAdvanceAmount:
            finalized.requiredAdvanceAmount !== null ? Number(finalized.requiredAdvanceAmount) : null,
        },
        finalized.items.map((item: any) => ({
          id: item.id,
          taxRatePercent: item.taxRatePercent !== null ? Number(item.taxRatePercent) : null,
          taxAmount: item.taxAmount !== null ? Number(item.taxAmount) : null,
        }))
      );
      return {
        enquiryId,
        selectedSupplierId: finalized.selectedSupplierId,
        selectedSupplierName: null,
        bestPriceTotal: Number(finalized.bestPriceTotal ?? 0),
        tentativeDeliveryDate: finalized.tentativeDeliveryDate ?? finalized.deliveryDate ?? new Date(),
        lineItems: [],
        finalized: false,
      };
    }
    throw error;
  }

  // OrderTracking entry: "Supplier marked order as Processing"
  await prisma.orderTracking
    .create({
      data: {
        orderId: enquiryId,
        status: newStatus,
        note: `Supplier marked order as Processing`,
      },
    })
    .catch(() => undefined);

  // Notification Engine — customer_order_status
  schedule(
    notifyCustomerOrderStatusChanged(prisma, {
      orderId: enquiryId,
      previousStatus: previousStatus as any,
      newStatus: newStatus as any,
    }).catch((err: any) => {
      onLog(`Failed customer_order_status notification: ${err instanceof Error ? err.message : String(err)}`);
    })
  );

  // Notification Engine — payment_required
  schedule(
    notifyPaymentRequired(prisma, {
      orderId: enquiryId,
      previousStatus: previousStatus as any,
      newStatus: newStatus as any,
    }).catch((err: any) => {
      onLog(`Failed payment_required notification: ${err instanceof Error ? err.message : String(err)}`);
    })
  );

  // Record RFQ-accepted price snapshots (non-blocking)
  void recordRfqAcceptedSnapshots(prisma, enquiryId, order.items, winningLines).catch((err: any) => {
    onLog(`Failed to record price snapshots: ${err instanceof Error ? err.message : String(err)}`);
  });

  return {
    enquiryId,
    selectedSupplierId,
    selectedSupplierName: selectedSupplierProfile?.companyName ?? null,
    bestPriceTotal,
    tentativeDeliveryDate,
    lineItems: winningLines,
    finalized: true,
    snapshot,
  };
}

async function recordRfqAcceptedSnapshots(
  prisma: any,
  enquiryId: string,
  items: Array<{ id: string; productId: string; product: { canonicalProductId: string | null } }>,
  winningLines: Array<BestLineItemSelection>
): Promise<void> {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const distinctSupplierIds = Array.from(new Set(winningLines.map((line) => line.supplierId)));

  const supplierProfiles = await prisma.supplierProfile.findMany({
    where: { id: { in: distinctSupplierIds } },
    select: { id: true, region: true },
  });
  const regionBySupplierId = new Map(supplierProfiles.map((p: any) => [p.id, p.region]));

  for (const line of winningLines) {
    const item = itemsById.get(line.lineItemId);
    if (!item) continue;

    await prisma.priceSnapshot
      .create({
        data: {
          productId: item.productId,
          canonicalProductId: item.product.canonicalProductId ?? null,
          supplierId: line.supplierId,
          region: regionBySupplierId.get(line.supplierId) ?? null,
          price: line.unitPrice,
          source: "RFQ_ACCEPTED",
          enquiryId,
        },
      })
      .catch(() => undefined);
  }
}

