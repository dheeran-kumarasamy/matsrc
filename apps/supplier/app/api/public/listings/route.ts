import { NextResponse } from "next/server";
import { getPublicSupplierListings } from "@/lib/supplier-data";

export async function GET() {
  try {
    const listings = await getPublicSupplierListings();
    return NextResponse.json(listings);
  } catch (error: any) {
    console.error("Public Listings API Error:", error);
    return NextResponse.json({ message: error?.message || "Internal server error" }, { status: 500 });
  }
}
