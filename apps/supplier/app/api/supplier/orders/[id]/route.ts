import { NextRequest, NextResponse } from "next/server";
import { OrderStatus } from "@matsrc/db";
import { getSupplierOrderDetail, updateSupplierOrderStatus } from "@/lib/supplier-data";

type Context = {
  params: { id: string };
};

export async function GET(_: NextRequest, { params }: Context) {
  const order = await getSupplierOrderDetail(params.id);
  if (!order) {
    return NextResponse.json({ message: "Order not found" }, { status: 404 });
  }
  return NextResponse.json({ order });
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const body = await request.json();
  const status = body.status as OrderStatus;

  if (!Object.values(OrderStatus).includes(status)) {
    return NextResponse.json({ message: "Invalid status" }, { status: 400 });
  }

  const order = await updateSupplierOrderStatus(params.id, status);
  return NextResponse.json({ order });
}