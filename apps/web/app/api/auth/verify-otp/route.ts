import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/builder-db";
import { normalizeEmail, isValidEmailFormat, normalizePhone } from "@/lib/contact-verification/validation";
import { verifyOtpChallenge, checkOtpVerifyRateLimit } from "@/lib/otp-service";
import { OtpPurpose } from "@matsrc/db";

export const dynamic = "force-dynamic";

// C20 Login OTP — verify step.
//
// Replaces the previous dev-mode stub (which accepted ANY syntactically
// valid 6-digit string, regardless of whether anything was ever sent) with
// real verification against the purpose-bound OtpChallenge issued by
// /api/auth/send-otp: purpose = LOGIN_OTP, scoped to the normalized
// identifier, hash-compared, expiry/attempt-limited, single-use.
//
// Preserves the EXISTING Auth.js architecture unchanged: on successful OTP
// verification this still only upserts the User row and returns its email —
// the client (unchanged) completes the actual sign-in via next-auth's
// Credentials provider exactly as before.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const channel = body?.channel;
    const rawIdentifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
    const otp = typeof body?.otp === "string" ? body.otp : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (channel !== "phone" && channel !== "email") {
      return NextResponse.json({ message: "Choose phone or email." }, { status: 400 });
    }
    if (!rawIdentifier) {
      return NextResponse.json({ message: "Missing phone/email." }, { status: 400 });
    }
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ message: "Enter the 6-digit code." }, { status: 400 });
    }

    let identifier: string | null;
    if (channel === "email") {
      identifier = isValidEmailFormat(rawIdentifier) ? normalizeEmail(rawIdentifier) : null;
    } else {
      identifier = normalizePhone(rawIdentifier);
    }
    if (!identifier) {
      return NextResponse.json({ message: "Invalid phone/email." }, { status: 400 });
    }

    const rateLimit = checkOtpVerifyRateLimit(identifier, OtpPurpose.LOGIN_OTP);
    if (!rateLimit.allowed) {
      return NextResponse.json({ message: "Too many attempts. Please try again later." }, { status: 429 });
    }

    const verified = await verifyOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier }, otp);

    if (!verified.ok) {
      const status = verified.code === "NOT_FOUND" || verified.code === "EXPIRED" ? 400 : 401;
      return NextResponse.json({ message: verified.message }, { status });
    }

    // The rest of this app resolves the signed-in user by email (see
    // lib/builder-db.ts's getUserCtx/resolveUserCtx and auth.ts's
    // Credentials provider), so a phone-only identifier is mapped to a
    // stable, deterministic placeholder email rather than introducing a
    // second identity key throughout the codebase — unchanged behaviour
    // from the previous implementation.
    const email = channel === "email" ? identifier : `${identifier.replace(/\D/g, "")}@phone.buildohub.in`;

    const user = await prisma.user.upsert({
      where: { email },
      update: name ? { name } : {},
      create: {
        email,
        name: name || null,
        phone: channel === "phone" ? identifier : null,
        role: "BUILDER",
      },
    });

    return NextResponse.json({ ok: true, email: user.email, name: user.name ?? "" });
  } catch (error: any) {
    console.error("verify-otp error:", error);
    const message = error?.message || "Failed to verify OTP";
    return NextResponse.json({ message }, { status: 400 });
  }
}
