import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { verifyContactChange } from "@/lib/contact-verification/service";
import { checkVerifyRateLimit } from "@/lib/contact-verification/rate-limit";
import type { ContactVerificationChannel } from "@matsrc/db";

export const dynamic = "force-dynamic";

// POST /api/builder/profile/contact-verification/verify
// Verifies the OTP for the caller's own pending email/phone change. Scoped
// strictly to the authenticated user's id (see getUserCtx/getOrCreateBuilder)
// so no request can verify or mutate another user's contact details.

function parseChannel(value: string | null | undefined): ContactVerificationChannel | null {
  if (value === "EMAIL" || value === "PHONE") return value;
  return null;
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const channel = parseChannel(body?.channel);
    const otp = typeof body?.otp === "string" ? body.otp.trim() : "";

    if (!channel) {
      return NextResponse.json({ message: "Invalid channel" }, { status: 400 });
    }
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ message: "Enter the 6-digit code." }, { status: 400 });
    }

    // Brute-force guard on top of the per-row attempts counter — bounds how
    // often this endpoint can be hit at all for a given user+channel.
    const rateLimit = checkVerifyRateLimit(user.id, channel);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many attempts. Please try again shortly.", code: "RATE_LIMITED", retryAfterMs: rateLimit.retryAfterMs },
        { status: 429 }
      );
    }

    const result = await verifyContactChange(user.id, channel, otp);
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "CONFLICT" ? 409 : 400;
      return NextResponse.json({ message: result.message, code: result.code }, { status });
    }

    return NextResponse.json({ ok: true, value: result.value });
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
    }
    console.error("contact-verification verify POST error:", error);
    return NextResponse.json({ message: "Failed to verify code" }, { status: 500 });
  }
}
