import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

// GET /api/admin/orders/[orderId]/site-receipt-sheet/pdf
// Proxies the NestJS admin/orders/:orderId/invoice/site-receipt-sheet/pdf endpoint
// so an admin can download the Delivery Challan / Site Material Receipt Sheet PDF.
export async function GET(request: Request, { params }: { params: { orderId: string } }) {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; name?: string | null; role?: string } | undefined;

  if (!user?.email || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = await fetch(`${API_BASE_URL}/admin/orders/${params.orderId}/invoice/site-receipt-sheet/pdf`, {
    cache: "no-store",
    headers: {
      "X-User-Id": user.id || user.email,
      "X-User-Email": user.email,
      "X-User-Name": user.name || "Admin",
      "X-User-Role": user.role || "ADMIN",
    },
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to load site receipt sheet PDF" }, { status: response.status });
  }

  const body = await response.arrayBuffer();
  const contentDisposition = response.headers.get("Content-Disposition") || "inline";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition,
      "Cache-Control": "private, no-store",
    },
  });
}
