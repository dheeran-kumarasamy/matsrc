import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// GET /api/builder/credit
// Returns the builder's credit/BNPL summary plus Bank Guarantee registration
// status (REQ-09). Creates a CreditProfile row on first access so the
// builder-facing UI always has something to render.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    let profile = await prisma.creditProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      profile = await prisma.creditProfile.create({
        data: { userId: user.id },
      });
    }

    return NextResponse.json({
      availableLimit: profile.creditLimit != null ? Number(profile.creditLimit) - Number(profile.usedLimit) : 0,
      status: profile.status,
      bankGuarantee: {
        enabled: profile.bankGuaranteeEnabled,
        status: profile.bankGuaranteeStatus,
        amount: profile.bankGuaranteeAmount != null ? Number(profile.bankGuaranteeAmount) : null,
        issuerName: profile.bankGuaranteeIssuerName,
        validTill: profile.bankGuaranteeValidTill,
        docUrl: profile.bankGuaranteeDocUrl,
        acceptedAt: profile.bankGuaranteeAcceptedAt,
      },
    });
  } catch (error) {
    console.error("Credit GET error:", error);
    return NextResponse.json({ error: "Failed to fetch credit summary" }, { status: 500 });
  }
}

// POST /api/builder/credit/bank-guarantee is a nested route (see
// bank-guarantee/route.ts) for the registration action itself; this POST here
// is kept minimal/reserved for future generic credit-product application use
// and intentionally left unimplemented to avoid duplicating that logic.
