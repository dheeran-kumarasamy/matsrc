import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBuyerServiceHeaders } from "@/lib/service-auth";
import { getBackendApiUrl } from "@/lib/buyer-proxy";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const backendUrl = getBackendApiUrl();
    const serviceHeaders = getBuyerServiceHeaders(session.user);
    const body = await req.json().catch(() => ({}));

    const response = await fetch(`${backendUrl}/builder/aggregation/opt-in`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...serviceHeaders,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Aggregation opt-in proxy error:", error);
    return NextResponse.json({ error: "Failed to opt in to aggregation pool" }, { status: 500 });
  }
}
