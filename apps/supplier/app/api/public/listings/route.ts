import { NextResponse } from "next/server";
import { getPublicSupplierListings } from "@/lib/supplier-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const listings = await getPublicSupplierListings();
    return NextResponse.json(listings, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error: any) {
    console.error("Public Listings API Error:", error);
    return NextResponse.json({ message: error?.message || "Internal server error" }, { status: 500 });
  }
}
