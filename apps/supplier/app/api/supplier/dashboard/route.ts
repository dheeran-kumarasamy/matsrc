import { NextResponse } from "next/server";
import { getSupplierDashboardData } from "@/lib/supplier-data";

export async function GET() {
  const data = await getSupplierDashboardData();
  return NextResponse.json(data);
}