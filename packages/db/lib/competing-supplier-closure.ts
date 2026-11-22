// packages/db/lib/competing-supplier-closure.ts
//
// Shared, framework-agnostic implementation to close competing supplier candidates and quotes
// when an order is accepted for processing by a buyer for one specific supplier.
//
// RULES:
// 1. The winning supplier's candidate rows on this order are marked ACCEPTED.
// 2. All competing candidate rows (other suppliers) are marked DECLINED with a generic closure reason.
// 3. All unselected quotes from other suppliers on this order are marked REJECTED.
// 4. An in-app Notification is generated for each competing supplier informing them that the
//    enquiry/order is no longer needed for fulfilment, stating all possible generic reasons
//    without disclosing commercial or competitor-specific details.

import {
  PrismaClient,
  Prisma,
  OrderItemCandidateStatus,
  SupplierQuoteStatus,
  NotificationChannel,
} from "@prisma/client";

export const GENERIC_ORDER_CLOSURE_REASON =
  "This enquiry/order is no longer required for fulfilment. Possible reasons include: requirement fulfilled by another option, project schedule revision, specification adjustment, or quotation window closed.";

export type CloseCompetingSuppliersParams = {
  orderId: string;
  winningSupplierId: string;
  reason?: string;
  enquiryId?: string | null;
};

export type CloseCompetingSuppliersResult = {
  candidatesClosed: number;
  quotesClosed: number;
  notifiedSupplierIds: string[];
};

/**
 * Closes out all competing candidate rows and unselected quotes for an order when
 * one supplier has been selected and accepted for processing.
 *
 * Safe to call inside an existing transaction or with the root PrismaClient.
 */
export async function closeCompetingSuppliersForOrder(
  db: PrismaClient | Prisma.TransactionClient,
  params: CloseCompetingSuppliersParams
): Promise<CloseCompetingSuppliersResult> {
  const { orderId, winningSupplierId, reason = GENERIC_ORDER_CLOSURE_REASON } = params;

  // 1. Resolve display reference for notifications (orderNumber ?? enquiryId ?? truncated orderId)
  let displayRef = params.enquiryId;
  if (!displayRef && db.order?.findUnique) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { enquiryId: true, orderNumber: true },
    });
    displayRef = order?.orderNumber || order?.enquiryId;
  }
  displayRef = displayRef || orderId.slice(0, 8);

  // 2. Mark winning supplier candidate rows as ACCEPTED (if any exist)
  if (db.orderItemSupplierCandidate?.updateMany) {
    await db.orderItemSupplierCandidate.updateMany({
      where: {
        orderItem: { orderId },
        supplierId: winningSupplierId,
        status: { not: OrderItemCandidateStatus.ACCEPTED },
      },
      data: {
        status: OrderItemCandidateStatus.ACCEPTED,
        respondedAt: new Date(),
      },
    });
  }

  // 3. Find competing candidates to capture supplier details for notifications
  const competingCandidates = db.orderItemSupplierCandidate?.findMany
    ? await db.orderItemSupplierCandidate.findMany({
        where: {
          orderItem: { orderId },
          supplierId: { not: winningSupplierId },
          status: OrderItemCandidateStatus.PENDING,
        },
        select: {
          id: true,
          supplierId: true,
          supplier: {
            select: {
              id: true,
              userId: true,
              companyName: true,
            },
          },
        },
      })
    : [];

  // 4. Mark competing candidate rows as DECLINED with the generic reason
  let updateCandidatesCount = 0;
  if (db.orderItemSupplierCandidate?.updateMany) {
    const res = await db.orderItemSupplierCandidate.updateMany({
      where: {
        orderItem: { orderId },
        supplierId: { not: winningSupplierId },
        status: OrderItemCandidateStatus.PENDING,
      },
      data: {
        status: OrderItemCandidateStatus.DECLINED,
        declineReason: reason,
        respondedAt: new Date(),
      },
    });
    updateCandidatesCount = res.count;
  }

  // 5. Update competing unselected supplier quotes to REJECTED with the generic reason
  let updateQuotesCount = 0;
  if (db.supplierQuote?.updateMany) {
    const res = await db.supplierQuote.updateMany({
      where: {
        enquiryId: orderId,
        supplierId: { not: winningSupplierId },
        status: { in: [SupplierQuoteStatus.PENDING_ADMIN_REVIEW, SupplierQuoteStatus.SENT_TO_BUYER] },
      },
      data: {
        status: SupplierQuoteStatus.REJECTED,
        adminNotes: reason,
      },
    });
    updateQuotesCount = res.count;
  }

  // 6. Build a deduplicated map of all competing suppliers who participated via candidates or quotes
  const competingSupplierMap = new Map<string, { id: string; userId: string; name: string }>();
  for (const c of competingCandidates) {
    if (c.supplier?.userId) {
      competingSupplierMap.set(c.supplier.id, {
        id: c.supplier.id,
        userId: c.supplier.userId,
        name: c.supplier.companyName,
      });
    }
  }

  const competingQuotes = db.supplierQuote?.findMany
    ? await db.supplierQuote.findMany({
        where: {
          enquiryId: orderId,
          supplierId: { not: winningSupplierId },
        },
        select: {
          supplier: {
            select: {
              id: true,
              userId: true,
              companyName: true,
            },
          },
        },
      })
    : [];

  for (const q of competingQuotes) {
    if (q.supplier?.userId) {
      competingSupplierMap.set(q.supplier.id, {
        id: q.supplier.id,
        userId: q.supplier.userId,
        name: q.supplier.companyName,
      });
    }
  }

  // 7. Generate in-app notifications for each competing supplier
  const notifiedSupplierIds: string[] = [];
  if (db.notification?.findFirst && db.notification?.create) {
    for (const [suppId, supp] of competingSupplierMap.entries()) {
      try {
        const idempotencyKey = `competing-supplier-closed:${orderId}:${suppId}`;
        const existing = await db.notification.findFirst({
          where: { idempotencyKey },
          select: { id: true },
        });

        if (!existing) {
          await db.notification.create({
            data: {
              userId: supp.userId,
              audience: "supplier",
              channel: NotificationChannel.IN_APP,
              title: `Enquiry Update: ${displayRef}`,
              body: `Enquiry ${displayRef}: ${reason}`,
              status: "delivered",
              read: false,
              variables: JSON.stringify({
                orderId,
                enquiryId: displayRef,
                closureReason: reason,
              }),
              idempotencyKey,
            },
          });
          notifiedSupplierIds.push(suppId);
        }
      } catch (err) {
        console.error(
          `Failed to create closure notification for supplier ${suppId} on order ${orderId}:`,
          err
        );
      }
    }
  }

  return {
    candidatesClosed: updateCandidatesCount,
    quotesClosed: updateQuotesCount,
    notifiedSupplierIds,
  };
}
