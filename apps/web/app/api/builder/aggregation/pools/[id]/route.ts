import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:4000/api";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const response = await fetch(`${BACKEND_URL}/builder/aggregation/pools/${params.id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": req.headers.get("X-User-Id") || "builder.demo@buildmart.local",
        "X-User-Email": req.headers.get("X-User-Email") || "builder.demo@buildmart.local",
        "X-User-Name": req.headers.get("X-User-Name") || "Demo Builder",
        "X-User-Role": req.headers.get("X-User-Role") || "BUILDER",
      },
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Aggregation pool detail proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch pool" }, { status: 500 });
  }
}
