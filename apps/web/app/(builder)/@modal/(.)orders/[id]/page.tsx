import { notFound } from "next/navigation";
import { builderApiGet } from "@/lib/api";
import OrderDetailOverlay, { type OverlayOrderDetail } from "@/components/orders/OrderDetailOverlay";

export const dynamic = "force-dynamic";

// Intercepting route (Next.js "(.)" convention): navigating to /orders/[id]
// from anywhere already inside the (builder) route group renders this into
// the @modal parallel slot instead of the real page, so the current page
// never unmounts. Direct load / refresh / shared link still renders the full
// standalone page at app/(builder)/orders/[id]/page.tsx (spec 5A).
export default async function OrderDetailOverlayRoute({ params }: { params: { id: string } }) {
  let order: OverlayOrderDetail | null = null;

  try {
    order = await builderApiGet<OverlayOrderDetail>(`/orders/${params.id}`);
  } catch {
    order = null;
  }

  if (!order) {
    notFound();
  }

  return <OrderDetailOverlay order={order} />;
}
