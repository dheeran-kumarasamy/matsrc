import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// POST /api/builder/credit/bank-guarantee
// REQ-09: Bank Guarantee registration, part of BUILDER onboarding/credit
// setup. Builder submits issuer, amount, validity and (optionally) a
// document URL (already uploaded via the existing KYC-style upload flow).
// Persists onto CreditProfile and marks the guarantee as PENDING review
// (reusing the CreditStatus lifecycle: NOT_APPLIED -> SCORING -> APPROVED).
export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const { issuerName, amount, validTill, docUrl } = body as {
      issuerName?: string;
      amount?: number;
      validTill?: string;
      docUrl?: string;
    };

    if (!issuerName || !amount) {
      return NextResponse.json(
        { error: "issuerName and amount are required" },
        { status: 400 }
      );
    }

    const profile = await prisma.creditProfile.upsert({
      where: { userId: user.id },
      update: {
        bankGuaranteeEnabled: true,
        bankGuaranteeStatus: "SCORING",
        bankGuaranteeAmount: amount,
        bankGuaranteeIssuerName: issuerName,
        bankGuaranteeValidTill: validTill ? new Date(validTill) : null,
        bankGuaranteeDocUrl: docUrl ?? null,
        bankGuaranteeAcceptedAt: new Date(),
      },
      create: {
        userId: user.id,
        bankGuaranteeEnabled: true,
        bankGuaranteeStatus: "SCORING",
        bankGuaranteeAmount: amount,
        bankGuaranteeIssuerName: issuerName,
        bankGuaranteeValidTill: validTill ? new Date(validTill) : null,
        bankGuaranteeDocUrl: docUrl ?? null,
        bankGuaranteeAcceptedAt: new Date(),
      },
    });

    return NextResponse.json({
      enabled: profile.bankGuaranteeEnabled,
      status: profile.bankGuaranteeStatus,
      amount: profile.bankGuaranteeAmount != null ? Number(profile.bankGuaranteeAmount) : null,
      issuerName: profile.bankGuaranteeIssuerName,
      validTill: profile.bankGuaranteeValidTill,
      docUrl: profile.bankGuaranteeDocUrl,
      acceptedAt: profile.bankGuaranteeAcceptedAt,
    });
  } catch (error) {
    console.error("Bank guarantee registration error:", error);
    return NextResponse.json(
      { error: "Failed to register bank guarantee" },
      { status: 500 }
    );
  }
}
