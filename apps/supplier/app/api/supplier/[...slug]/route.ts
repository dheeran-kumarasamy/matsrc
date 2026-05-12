import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createSupplierListing,
  createSupplierQuote,
  getSupplierListings,
  getSupplierOrders,
  getSupplierRfqs,
  updateSupplierListing,
  updateSupplierOrderStatus,
  updateSupplierProfile,
  getMarketScrollerData,
} from "@/lib/supplier-data";

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
    } else {
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
    const body = await req.json();

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

