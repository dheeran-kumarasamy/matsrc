import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getSupplierListings, parseListingPrice } from "@/lib/listings";
import type { CostSavingsRow, CostSavingsSummary } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

// Potential Cost Savings: derived report combining Material Consumption
// (what/how much the builder has ordered) with Best Supplier Pricing
// (current cross-supplier prices for the same canonical product). For each
// past order line, compares the price actually paid against the cheapest
// price currently available for that material and sums the gap. Purely
// computed from the two other real reports' data sources — no new model.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const orderItems = await prisma.orderItem.findMany({
      where: { order: { userId: user.id } },
      select: {
        quantity: true,
        unitPrice: true,
        productId: true,
        product: {
          select: {
            name: true,
            unit: true,
            canonicalProductId: true,
            canonicalProduct: { select: { canonicalKey: true } },
          },
        },
      },
    });

    const relevant = orderItems.filter((item) => item.product.canonicalProduct);

    if (relevant.length === 0) {
      return NextResponse.json({ totalPotentialSavings: 0, rows: [] } satisfies CostSavingsSummary);
    }

    const listings = await getSupplierListings();

    // Pre-compute the current cheapest active price per canonical key.
    const cheapestByCanonicalKey = new Map<string, number>();
    for (const listing of listings) {
      if (!listing.active || !listing.canonicalProductId) continue;
      const price = parseListingPrice(listing.price);
      const existing = cheapestByCanonicalKey.get(listing.canonicalProductId);
      if (existing === undefined || price < existing) {
        cheapestByCanonicalKey.set(listing.canonicalProductId, price);
      }
    }

    const byProduct = new Map<string, CostSavingsRow>();

    for (const item of relevant) {
      const canonicalKey = item.product.canonicalProduct!.canonicalKey;
      const currentBestUnitPrice = cheapestByCanonicalKey.get(canonicalKey);
      if (currentBestUnitPrice === undefined) continue;

      const paidUnitPrice = Number(item.unitPrice);
      const existing = byProduct.get(item.productId);

      if (existing) {
        existing.quantityOrdered += item.quantity;
        existing.amountPaid += paidUnitPrice * item.quantity;
      } else {
        byProduct.set(item.productId, {
          productId: item.productId,
          name: item.product.name,
          unit: item.product.unit,
          quantityOrdered: item.quantity,
          amountPaid: paidUnitPrice * item.quantity,
          currentBestUnitPrice,
          potentialSavings: 0,
        });
      }
    }

    const rows = Array.from(byProduct.values())
      .map((row) => {
        const currentBestTotal = row.currentBestUnitPrice * row.quantityOrdered;
        const potentialSavings = Math.max(0, row.amountPaid - currentBestTotal);
        return { ...row, potentialSavings };
      })
      .filter((row) => row.potentialSavings > 0)
      .sort((a, b) => b.potentialSavings - a.potentialSavings);

    const totalPotentialSavings = rows.reduce((sum, row) => sum + row.potentialSavings, 0);

    return NextResponse.json({ totalPotentialSavings, rows } satisfies CostSavingsSummary);
  } catch (error) {
    console.error("Cost savings report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
