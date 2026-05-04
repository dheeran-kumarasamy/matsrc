import { NextResponse } from "next/server";
import { getSupplierOrders } from "@/lib/supplier-data";

export async function GET() {
  const orders = await getSupplierOrders();
  return NextResponse.json({ orders });
}