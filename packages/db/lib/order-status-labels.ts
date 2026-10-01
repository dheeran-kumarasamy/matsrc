// packages/db/lib/order-status-labels.ts
//
// Single source of truth for the customer-friendly display label of every
// `OrderStatus` enum value (packages/db/prisma/schema.prisma). Mirrors the
// labels already shown to Builders across the web app (see
// apps/web/components/orders/OrderStatusBadge.tsx / OrderTimeline.tsx /
// apps/web/app/(builder)/orders/page.tsx and
// apps/web/app/(newdash)/newdashboard/page.tsx's local `STATUS_LABELS`
// maps) — this does NOT introduce a second/competing label scheme, it just
// gives backend code (the Notification Engine's `customer_order_status`
// WhatsApp template — see
// apps/api/src/notification-engine/whatsapp/customer-order-status-notification.service.ts)
// a single place to read the same labels from, since none of those existing
// maps live in a package importable from apps/api.
//
// IMPORTANT: keep this in sync with the frontend label maps above if either
// ever changes — there is intentionally no runtime dependency between them
// (apps/web is a separate deployable), but the *values* must stay identical
// so a customer sees the same wording in the app and in the WhatsApp message.
import { OrderStatus } from "@prisma/client";

export const ORDER_STATUS_DISPLAY_LABELS: Record<OrderStatus, string> = {
  // "Enquiry" (not "Placed") — matches the existing label everywhere a
  // PLACED order is shown to a Builder (OrderStatusBadge.tsx, orders/page.tsx
  // FILTER_LABELS, newdashboard's STATUS_LABELS).
  PLACED: "Enquiry",
  PROCESSING: "Processing",
  DISPATCHED: "Dispatched",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/** Returns the customer-friendly label for an `OrderStatus`, falling back to the raw value for any future enum member this map hasn't been updated for yet. */
export function getOrderStatusDisplayLabel(status: OrderStatus | string): string {
  return ORDER_STATUS_DISPLAY_LABELS[status as OrderStatus] ?? String(status);
}
