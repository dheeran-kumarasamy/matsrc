import { NextRequest, NextResponse } from "next/server";
import { createSupplierListing, getSupplierListings } from "@/lib/supplier-data";

export async function GET() {
  const listings = await getSupplierListings();
  return NextResponse.json({ listings });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const listing = await createSupplierListing(body);
  return NextResponse.json({ listing }, { status: 201 });
}