import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

// Proxies the NestJS admin/advance-payments/:id/screenshot endpoint — same
// pattern as apps/admin/app/api/admin/payments/[orderId]/screenshot/route.ts.
// An <img> tag cannot attach the custom X-User-* headers the rest of this
// app's adminApi* helpers rely on, so this route re-authenticates via the
// NextAuth session and forwards to the NestJS endpoint, which re-checks the
// ADMIN role itself via RoleGuard — gated at both layers.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; name?: string | null; role?: string } | undefined;

  if (!user?.email || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = await fetch(`${API_BASE_URL}/admin/advance-payments/${params.id}/screenshot`, {
    cache: "no-store",
    headers: {
      "X-User-Id": user.id || user.email,
      "X-User-Email": user.email,
      "X-User-Name": user.name || "Admin",
      "X-User-Role": user.role || "ADMIN",
    },
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to load screenshot" }, { status: response.status });
  }

  const contentType = response.headers.get("Content-Type") || "application/octet-stream";
  const body = await response.arrayBuffer();

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
    },
  });
}
