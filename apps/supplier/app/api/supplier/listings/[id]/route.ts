import { NextRequest, NextResponse } from "next/server";
import { getSupplierListingById, updateSupplierListing } from "@/lib/supplier-data";

type Context = {
  params: { id: string };
};

export async function GET(_: NextRequest, { params }: Context) {
  const listing = await getSupplierListingById(params.id);
  if (!listing) {
    return NextResponse.json({ message: "Listing not found" }, { status: 404 });
  }
  return NextResponse.json({ listing });
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const body = await request.json();
  const listing = await updateSupplierListing(params.id, body);
  if (!listing) {
    return NextResponse.json({ message: "Listing not found" }, { status: 404 });
  }
  return NextResponse.json({ listing });
}