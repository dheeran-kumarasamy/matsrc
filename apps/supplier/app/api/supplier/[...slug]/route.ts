import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createSupplierListing,
  createSupplierQuote,
  getSupplierListingById,
  getSupplierListings,
  getSupplierOrderDetail,
  getSupplierOrders,
  getSupplierRfqs,
  updateSupplierListing,
  updateSupplierOrderStatus,
  updateSupplierProfile,
  getMarketScrollerData,
  getSupplierAggregationPools,
  forceLockAggregationPool,
  updateListingAggregationSettings,
} from "@/lib/supplier-data";


import {
  acknowledgeSupplierPurchaseOrder,
  getSupplierPurchaseOrderDetail,
  getSupplierPurchaseOrders,
} from "@/lib/purchase-order-data";

async function requireEmail(req: NextRequest): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const email = await requireEmail(req);
    if (!email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const path = req.nextUrl.pathname.replace("/api/supplier", "");

    if (path === "/listings") {
      const listings = await getSupplierListings(email);
      return NextResponse.json(listings);
    } else if (path === "/orders") {
      const orders = await getSupplierOrders(email);
      return NextResponse.json(orders);
    } else if (path === "/rfqs") {
      const rfqs = await getSupplierRfqs(email);
      return NextResponse.json(rfqs);
    } else if (path === "/market-scroll") {
      const items = await getMarketScrollerData(email);
      return NextResponse.json(items);
    } else if (path === "/purchase-orders") {
      const purchaseOrders = await getSupplierPurchaseOrders(email);
      return NextResponse.json(purchaseOrders);
    } else if (path === "/aggregation/pools") {
      const pools = await getSupplierAggregationPools(email);
      return NextResponse.json(pools);
    } else {
      const poMatch = path.match(/^\/purchase-orders\/([^/]+)$/);

      if (poMatch) {
        const detail = await getSupplierPurchaseOrderDetail(poMatch[1], email);
        if (!detail) {
          return NextResponse.json({ message: "Purchase order not found" }, { status: 404 });
        }
        return NextResponse.json(detail);
      }

      // Used by the dashboard "View" overlay to fetch order details on demand.
      const orderMatch = path.match(/^\/orders\/([^/]+)$/);
      if (orderMatch) {
        const detail = await getSupplierOrderDetail(orderMatch[1], email);
        if (!detail) {
          return NextResponse.json({ message: "Order not found" }, { status: 404 });
        }
        return NextResponse.json(detail);
      }

      // Used by the dashboard "View" overlay to fetch product/listing details on demand.
      const listingMatch = path.match(/^\/listings\/([^/]+)$/);
      if (listingMatch) {
        const detail = await getSupplierListingById(listingMatch[1], email);
        if (!detail) {
          return NextResponse.json({ message: "Listing not found" }, { status: 404 });
        }
        return NextResponse.json(detail);
      }

      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ message: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const email = await requireEmail(req);
    if (!email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const path = req.nextUrl.pathname.replace("/api/supplier", "");
    const body = await req.json().catch(() => ({}));

    if (path === "/listings") {
      const created = await createSupplierListing(body, email);
      return NextResponse.json(created, { status: 201 });
    }

    const quoteMatch = path.match(/^\/rfqs\/([^/]+)\/quote$/);
    if (quoteMatch) {
      const rfqId = quoteMatch[1];
      const created = await createSupplierQuote(rfqId, body, email);
      if (!created) {
        return NextResponse.json({ message: "RFQ not found" }, { status: 404 });
      }
      return NextResponse.json(created, { status: 201 });
    }

    // Supplier-side: POST /supplier/purchase-orders/:id/acknowledge — confirm receipt in-app.
    const acknowledgeMatch = path.match(/^\/purchase-orders\/([^/]+)\/acknowledge$/);
    if (acknowledgeMatch) {
      const updated = await acknowledgeSupplierPurchaseOrder(acknowledgeMatch[1], email);
      return NextResponse.json(updated);
    }

    const forceLockMatch = path.match(/^\/aggregation\/pools\/([^/]+)\/force-lock$/);
    if (forceLockMatch) {
      const result = await forceLockAggregationPool(forceLockMatch[1], email);
      return NextResponse.json(result);
    }

    return NextResponse.json({ message: "Not found" }, { status: 404 });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ message: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const email = await requireEmail(req);
    if (!email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const path = req.nextUrl.pathname.replace("/api/supplier", "");
    const body = await req.json();

    const aggregationSettingsMatch = path.match(/^\/listings\/([^/]+)\/aggregation-settings$/);
    if (aggregationSettingsMatch) {
      const listingId = aggregationSettingsMatch[1];
      const updated = await updateListingAggregationSettings(listingId, body, email);
      return NextResponse.json(updated);
    }

    const listingMatch = path.match(/^\/listings\/([^/]+)$/);
    if (listingMatch) {
      const listingId = listingMatch[1];
      const updated = await updateSupplierListing(listingId, body, email);
      if (!updated) {
        return NextResponse.json({ message: "Listing not found" }, { status: 404 });
      }
      return NextResponse.json(updated);
    }


    const orderMatch = path.match(/^\/orders\/([^/]+)$/);
    if (orderMatch) {
      const orderId = orderMatch[1];
      const updated = await updateSupplierOrderStatus(orderId, body.status);
      return NextResponse.json(updated);
    }

    if (path === "/profile") {
      const updated = await updateSupplierProfile(body, email);
      return NextResponse.json(updated);
    }

    return NextResponse.json({ message: "Not found" }, { status: 404 });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ message: error.message || "Internal server error" }, { status: 500 });
  }
}
