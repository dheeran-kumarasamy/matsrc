import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

function adminHeaders(user: { id?: string; email: string; name?: string | null; role?: string }) {
  return {
    "X-User-Id": user.id || user.email,
    "X-User-Email": user.email,
    "X-User-Name": user.name || "Admin",
    "X-User-Role": user.role || "ADMIN",
  };
}

export async function POST(
  request: Request,
  { params }: { params: { orderId: string; quoteId: string } }
) {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; name?: string | null; role?: string } | undefined;

  if (!user?.email || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  const response = await fetch(`${API_BASE_URL}/admin/orders/${params.orderId}/quotes/${params.quoteId}/review`, {
    method: "POST",
    headers: {
      ...adminHeaders(user as any),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
