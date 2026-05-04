import { NextRequest, NextResponse } from "next/server";
import { getSupplierProfileData, updateSupplierProfile } from "@/lib/supplier-data";

export async function GET() {
  const data = await getSupplierProfileData();
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const profile = await updateSupplierProfile(body);
  return NextResponse.json({ profile });
}