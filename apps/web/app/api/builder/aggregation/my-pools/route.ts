import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBuyerServiceHeaders } from "@/lib/service-auth";
import { getBackendApiUrl } from "@/lib/buyer-proxy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const backendUrl = getBackendApiUrl();
    const serviceHeaders = getBuyerServiceHeaders(session.user);

    const response = await fetch(`${backendUrl}/builder/aggregation/my-pools`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...serviceHeaders,
      },
      cache: "no-store",
    });

    const data = await response.json().catch(() => ([]));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Aggregation my-pools proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch group orders" }, { status: 500 });
  }
}
