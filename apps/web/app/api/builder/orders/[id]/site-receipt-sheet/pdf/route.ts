import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/builder/orders/[id]/site-receipt-sheet/pdf
//
// Delivery Challan download is restricted exclusively to administrators.
// The admin generates the invoice, downloads the Delivery Challan, and shares
// it with the buyer when required. Direct download by buyers is disabled.
export async function GET() {
  return NextResponse.json(
    { error: "Delivery Challan is accessible only by administrators." },
    { status: 403 }
  );
}

