import { NextResponse } from "next/server";
import { POST as ordersPost } from "@/app/api/builder/orders/route";

// /api/builder/orders/checkout is an alias for placing an order
export { ordersPost as POST };
