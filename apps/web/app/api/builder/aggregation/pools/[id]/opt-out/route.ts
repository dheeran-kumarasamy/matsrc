import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:4000/api";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const response = await fetch(`${BACKEND_URL}/builder/aggregation/pools/${params.id}/opt-out`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": req.headers.get("X-User-Id") || "builder.demo@buildmart.local",
        "X-User-Email": req.headers.get("X-User-Email") || "builder.demo@buildmart.local",
        "X-User-Name": req.headers.get("X-User-Name") || "Demo Builder",
        "X-User-Role": req.headers.get("X-User-Role") || "BUILDER",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Aggregation opt-out proxy error:", error);
    return NextResponse.json({ error: "Failed to opt out of pool" }, { status: 500 });
  }
}
