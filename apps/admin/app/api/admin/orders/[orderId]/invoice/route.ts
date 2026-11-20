import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdminServerHeaders } from "@/lib/service-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

// Proxies the NestJS admin/orders/:orderId/invoice endpoints (GET existing
// invoice, POST = Generate Invoice) with the admin's NextAuth session
// re-validated server-side — mirrors the existing admin/payments proxy
// pattern. The downstream NestJS route re-checks the ADMIN role itself via
// RoleGuard, so a non-admin caller is rejected at both layers.
async function requireAdmin() {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; name?: string | null; role?: string } | undefined;
  if (!user?.email || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
    return null;
  }
  return user;
}

function adminHeaders(user: { id?: string; email: string; name?: string | null; role?: string }) {
  return getAdminServerHeaders(user);
}

export async function GET(request: Request, { params }: { params: { orderId: string } }) {
  const user = await requireAdmin();
  if (!user?.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = await fetch(`${API_BASE_URL}/admin/orders/${params.orderId}/invoice`, {
    cache: "no-store",
    headers: adminHeaders(user as any),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

export async function POST(request: Request, { params }: { params: { orderId: string } }) {
  const user = await requireAdmin();
  if (!user?.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = await fetch(`${API_BASE_URL}/admin/orders/${params.orderId}/invoice`, {
    method: "POST",
    headers: adminHeaders(user as any),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
