import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdminServerHeaders } from "@/lib/service-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export async function GET(request: Request, { params }: { params: { orderId: string } }) {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; name?: string | null; role?: string } | undefined;

  if (!user?.email || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = await fetch(`${API_BASE_URL}/admin/orders/${params.orderId}/quotes`, {
    cache: "no-store",
    headers: getAdminServerHeaders(user),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
