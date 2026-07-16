import { builderApiGet } from "@/lib/api";
import OrdersListOverlay, { type OverlayOrderItem } from "@/components/orders/OrdersListOverlay";

export const dynamic = "force-dynamic";

// Intercepting route (Next.js "(.)" convention): navigating to /orders from
// anywhere already inside the (builder) route group renders this into the
// @modal parallel slot instead of the real page, so the current page never
// unmounts. Direct load / refresh / shared link still renders the full
// standalone page at app/(builder)/orders/page.tsx (spec 5A).
export default async function OrdersOverlayRoute() {
  let orders: OverlayOrderItem[] = [];
  let apiError = false;

  try {
    orders = await builderApiGet<OverlayOrderItem[]>("/orders");
  } catch {
    orders = [];
    apiError = true;
  }

  return <OrdersListOverlay orders={orders} apiError={apiError} />;
}
