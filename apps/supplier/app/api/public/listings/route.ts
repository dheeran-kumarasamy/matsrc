import { NextResponse } from "next/server";
import { getPublicSupplierListings } from "@/lib/supplier-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const listings = await getPublicSupplierListings();
    return NextResponse.json(listings, {
      headers: {
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      },
    });
  } catch (error: any) {
    console.error("Public Listings API Error:", error);
    return NextResponse.json({ message: error?.message || "Internal server error" }, { status: 500 });
  }
}
