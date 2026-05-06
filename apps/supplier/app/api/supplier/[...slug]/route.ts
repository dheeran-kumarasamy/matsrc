import { NextRequest, NextResponse } from "next/server";
import {
  createSupplierListing,
  createSupplierQuote,
  getSupplierListings,
  getSupplierOrders,
  getSupplierRfqs,
  updateSupplierListing,
  updateSupplierOrderStatus,
  updateSupplierProfile,
} from "@/lib/supplier-data";

// Helper function to extract user from request headers
// In development, we accept user info from custom headers
function extractUserFromRequest(req: NextRequest): { id: string; email: string; name?: string; role?: string } | null {
  // Try to get from custom headers (set by middleware or test)
  const userId = req.headers.get("x-user-id");
  const userEmail = req.headers.get("x-user-email");
  
  if (userId && userEmail) {
    return {
      id: userId,
      email: userEmail,
      name: req.headers.get("x-user-name") || undefined,
      role: req.headers.get("x-user-role") || "SUPPLIER",
    };
  }
  
  // For now, return a demo user in development
  return {
    id: "supplier@demo",
    email: "supplier@demo@buildmart.local",
    name: "Demo Supplier",
    role: "SUPPLIER",
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = extractUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const path = req.nextUrl.pathname.replace("/api/supplier", "");

    // Route to appropriate data handler based on path
    if (path === "/listings") {
      const listings = await getSupplierListings();
      return NextResponse.json(listings);
    } else if (path === "/orders") {
      const orders = await getSupplierOrders();
      return NextResponse.json(orders);
    } else if (path === "/rfqs") {
      const rfqs = await getSupplierRfqs();
      return NextResponse.json(rfqs);
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
    const user = extractUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const path = req.nextUrl.pathname.replace("/api/supplier", "");
    const body = await req.json();

    if (path === "/listings") {
      const created = await createSupplierListing(body);
      return NextResponse.json(created, { status: 201 });
    }

    const quoteMatch = path.match(/^\/rfqs\/([^/]+)\/quote$/);
    if (quoteMatch) {
      const rfqId = quoteMatch[1];
      const created = await createSupplierQuote(rfqId, body);
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
    const user = extractUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const path = req.nextUrl.pathname.replace("/api/supplier", "");
    const body = await req.json();

    const listingMatch = path.match(/^\/listings\/([^/]+)$/);
    if (listingMatch) {
      const listingId = listingMatch[1];
      const updated = await updateSupplierListing(listingId, body);
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
      const updated = await updateSupplierProfile(body);
      return NextResponse.json(updated);
    }

    return NextResponse.json({ message: "Not found" }, { status: 404 });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ message: error.message || "Internal server error" }, { status: 500 });
  }
}
