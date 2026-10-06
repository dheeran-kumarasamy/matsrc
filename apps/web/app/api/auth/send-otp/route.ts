import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/builder-db";
import { normalizeEmail, isValidEmailFormat, normalizePhone } from "@/lib/contact-verification/validation";
import { issueOtpChallenge, deliverOtp, checkOtpSendRateLimit } from "@/lib/otp-service";
import { OtpPurpose } from "@matsrc/db";

export const dynamic = "force-dynamic";

// C20 Login OTP — send step.
//
// Replaces the previous dev-mode stub (which never generated or sent any
// OTP and logged "enter any 6-digit code to continue") with a real,
// purpose-bound OTP challenge (see lib/otp-service):
//   1. Validate + normalize the identifier (phone -> E.164, email -> lowercase).
//   2. Resolve the existing BuildOhub user for this identifier, if any
//      (a brand-new phone/email has no user yet — issueOtpChallenge still
//      works with userId = null; verify-otp creates the User row on
//      success, exactly as the previous implementation did).
//   3. Generate + persist a real OTP challenge (crypto.randomInt-based,
//      hashed, 5-minute expiry, resend cooldown, rate-limited).
//   4. Attempt delivery: SMS (MSG91) is currently disabled — every OTP is
//      sent via SES email, regardless of channel, IF the account has a
//      usable email on file (phone-channel login still requires a verified
//      email on the account for delivery to succeed; see deliverOtp()).
//   5. Return an HONEST delivery result — never "SMS sent" when MSG91 is
//      stubbed, never a generic success if nothing was actually delivered.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const channel = body?.channel;
    const rawIdentifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";

    if (channel !== "phone" && channel !== "email") {
      return NextResponse.json({ message: "Choose phone or email." }, { status: 400 });
    }
    if (!rawIdentifier) {
      return NextResponse.json(
        { message: channel === "phone" ? "Enter your phone number." : "Enter your email address." },
        { status: 400 }
      );
    }

    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
    const ipLimit = checkOtpSendRateLimit(ip);
    if (!ipLimit.allowed) {
      return NextResponse.json({ message: "Too many OTP requests. Please try again later." }, { status: 429 });
    }

    let identifier: string | null;
    if (channel === "email") {
      identifier = isValidEmailFormat(rawIdentifier) ? normalizeEmail(rawIdentifier) : null;
    } else {
      identifier = normalizePhone(rawIdentifier);
    }
    if (!identifier) {
      return NextResponse.json(
        { message: channel === "phone" ? "Enter a valid phone number." : "Enter a valid email address." },
        { status: 400 }
      );
    }

    const existingUser =
      channel === "email"
        ? await prisma.user.findUnique({ where: { email: identifier } })
        : await prisma.user.findUnique({ where: { phone: identifier } });

    const issued = await issueOtpChallenge({
      purpose: OtpPurpose.LOGIN_OTP,
      identifier,
      userId: existingUser?.id ?? null,
    });

    if (!issued.ok) {
      return NextResponse.json({ message: issued.message }, { status: 429 });
    }

    const target =
      channel === "email"
        ? { email: identifier }
        : { phone: identifier, email: existingUser?.email ?? null };

    const delivery = await deliverOtp(issued.challengeId, target, issued.otp);

    if (!delivery.ok) {
      const message =
        delivery.code === "NO_EMAIL_FALLBACK"
          ? "SMS delivery is currently unavailable, and no verified email address is on file to send the OTP to. Please register with an email address or try again later."
          : delivery.message;
      return NextResponse.json({ message }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      channel: delivery.channel,
      maskedTarget: delivery.maskedTarget,
      message:
        delivery.channel === "EMAIL"
          ? `OTP sent to your registered email (${delivery.maskedTarget}).`
          : `OTP sent via SMS to ${delivery.maskedTarget}.`,
    });
  } catch (error) {
    console.error("send-otp error:", error);
    return NextResponse.json({ message: "Failed to send OTP" }, { status: 400 });
  }
}
