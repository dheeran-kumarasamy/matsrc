import { NextResponse } from "next/server";
import { getOrCreateAdvanceAccount } from "@matsrc/db";
import { prisma, getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// GET /api/builder/advance
//
// Buildohub Advance Balance summary for the authenticated buyer: available
// balance (cached, ledger-consistent — see CustomerAdvanceAccount doc
// comment in schema.prisma) plus the sum of any still-PENDING advance
// payments, shown SEPARATELY and NEVER folded into availableBalance (a
// pending manual payment is not spendable until an admin approves it).
//
// Lazily creates the buyer's CustomerAdvanceAccount on first access so a
// brand-new buyer always sees a ₹0 balance instead of a 404/empty state.
export async function GET(request: Request) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const account = await getOrCreateAdvanceAccount(prisma as any, user.id);

    const fullAccount = await prisma.customerAdvanceAccount.findUnique({
      where: { id: account.id },
      select: { id: true, currency: true, availableBalance: true, status: true },
    });

    const pendingAgg = await prisma.advancePayment.aggregate({
      where: { buyerId: user.id, status: "PENDING" },
      _sum: { amount: true },
    });

    return NextResponse.json({
      availableBalance: fullAccount ? Number(fullAccount.availableBalance) : 0,
      pendingAdvance: Number(pendingAgg._sum.amount ?? 0),
      currency: fullAccount?.currency ?? "INR",
      status: fullAccount?.status ?? "ACTIVE",
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Advance balance GET error:", error);
    return NextResponse.json({ error: "Failed to fetch advance balance" }, { status: 500 });
  }
}
