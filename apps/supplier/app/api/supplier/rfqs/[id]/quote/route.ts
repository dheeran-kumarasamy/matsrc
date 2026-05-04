import { NextRequest, NextResponse } from "next/server";
import { createSupplierQuote } from "@/lib/supplier-data";

type Context = {
  params: { id: string };
};

export async function POST(request: NextRequest, { params }: Context) {
  const body = await request.json();
  const quote = await createSupplierQuote(params.id, body);
  if (!quote) {
    return NextResponse.json({ message: "RFQ not found" }, { status: 404 });
  }
  return NextResponse.json({ quote }, { status: 201 });
}