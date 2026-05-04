import { NextResponse } from "next/server";
import { getSupplierRfqs } from "@/lib/supplier-data";

export async function GET() {
  const rfqs = await getSupplierRfqs();
  return NextResponse.json({ rfqs });
}