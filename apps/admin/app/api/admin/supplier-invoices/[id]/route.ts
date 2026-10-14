import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

async function requireAdmin() {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; name?: string | null; role?: string } | undefined;
  if (!user?.email || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
    return null;
  }
  return user;
}

function adminHeaders(user: { id?: string; email: string; name?: string | null; role?: string }) {
  return {
    "X-User-Id": user.id || user.email,
    "X-User-Email": user.email,
    "X-User-Name": user.name || "Admin",
    "X-User-Role": user.role || "ADMIN",
  };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await requireAdmin();
  if (!user?.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = await fetch(`${API_BASE_URL}/admin/supplier-invoices/${params.id}`, {
    cache: "no-store",
    headers: adminHeaders(user as any),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
