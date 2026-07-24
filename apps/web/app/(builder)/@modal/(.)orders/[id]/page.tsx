import { notFound } from "next/navigation";
import { builderApiGet, ApiError } from "@/lib/api";
import OrderDetailOverlay, { OrderDetailErrorOverlay, type OverlayOrderDetail } from "@/components/orders/OrderDetailOverlay";



export const dynamic = "force-dynamic";

// Intercepting route (Next.js "(.)" convention): navigating to /orders/[id]
// from anywhere already inside the (builder) route group renders this into
// the @modal parallel slot instead of the real page, so the current page
// never unmounts. Direct load / refresh / shared link still renders the full
// standalone page at app/(builder)/orders/[id]/page.tsx (spec 5A).
export default async function OrderDetailOverlayRoute({ params }: { params: { id: string } }) {
  let order: OverlayOrderDetail | null = null;
  let loadError = false;

  try {
    order = await builderApiGet<OverlayOrderDetail>(`/orders/${params.id}`);
  } catch (error) {
    // Only a genuine 404 from the API (order doesn't exist / doesn't belong
    // to this builder) should render Next's not-found page. Any other
    // failure (auth/session timing, transient 5xx, network blip) should show
    // a retryable error state instead of a permanent-looking 404 — this was
    // the root cause of "clicking enquiry button shows 404 page" even for
    // orders that do exist.
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    loadError = true;
  }

  if (loadError) {
    return <OrderDetailErrorOverlay orderId={params.id} />;
  }

  if (!order) {
    notFound();
  }

  return <OrderDetailOverlay order={order} />;
}

