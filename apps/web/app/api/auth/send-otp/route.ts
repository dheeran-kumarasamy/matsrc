import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/builder-db";
import { normalizeEmail, isValidEmailFormat, normalizePhone } from "@/lib/contact-verification/validation";
import { issueOtpChallenge, deliverOtp, deliverOtpViaWhatsApp, checkOtpSendRateLimit } from "@/lib/otp-service";
import { OtpPurpose, Role } from "@matsrc/db";

export const dynamic = "force-dynamic";

// C20 Login OTP — send step.
//
// WhatsApp is now the PRIMARY login OTP channel ("whatsapp"), with "email"
// as the explicit, user-selected FALLBACK. "phone" is retained ONLY as a
// legacy alias of "whatsapp" for any older client code still sending it —
// SMS (MSG91) remains disabled either way; see deliverOtp()/deliverOtpViaWhatsApp().
//
//   1. Validate + normalize the identifier (phone -> E.164, email -> lowercase).
//   2. Resolve the existing BuildOhub user for this identifier, if any
//      (a brand-new phone/email has no user yet — issueOtpChallenge still
//      works with userId = null; verify-otp creates the User row on
//      success, exactly as the previous implementation did).
//   3. Generate + persist a real OTP challenge (crypto.randomInt-based,
//      hashed, 5-minute expiry, resend cooldown, rate-limited).
//   4. Attempt delivery on the EXPLICITLY requested channel only:
//        - "whatsapp"/"phone": delivered to User.whatsappNumber, falling
//          back to User.phone only if whatsappNumber is unset — the
//          existing Buildohub convention (see resolveRecipient() in
//          apps/api/src/notifications/notification.service.ts). WhatsApp
//          failure is reported honestly and NEVER auto-falls-back to email.
//        - "email": delivered via SES email, exactly as before.
//   5. Return an HONEST delivery result — never claim WhatsApp/SMS was sent
//      when it wasn't, never a generic success if nothing was delivered.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const rawChannel = body?.channel;
    // "phone" is a legacy alias for "whatsapp" (older client code / the
    // registration page still sends "phone") — both resolve to a WhatsApp
    // delivery attempt against the normalized phone identifier.
    const channel: "whatsapp" | "email" = rawChannel === "email" ? "email" : rawChannel === "whatsapp" || rawChannel === "phone" ? "whatsapp" : (null as any);
    const rawIdentifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";

    if (channel !== "whatsapp" && channel !== "email") {
      return NextResponse.json({ message: "Choose WhatsApp or email." }, { status: 400 });
    }
    if (!rawIdentifier) {
      return NextResponse.json(
        { message: channel === "whatsapp" ? "Enter your WhatsApp number." : "Enter your email address." },
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
        { message: channel === "whatsapp" ? "Enter a valid WhatsApp number." : "Enter a valid email address." },
        { status: 400 }
      );
    }

    // NOTE: `phone` is intentionally NOT a unique field (see schema.prisma
    // comment — the same phone number can now legitimately belong to both
    // a Buyer and a Supplier account, keyed by their distinct portal-scoped
    // emails) — findFirst(), not findUnique(), is required here.
    const existingUser =
      channel === "email"
        ? await prisma.user.findUnique({ where: { email: identifier } })
        : await prisma.user.findFirst({ where: { phone: identifier, role: Role.BUILDER } });

    const issued = await issueOtpChallenge({
      purpose: OtpPurpose.LOGIN_OTP,
      identifier,
      userId: existingUser?.id ?? null,
    });

    if (!issued.ok) {
      return NextResponse.json({ message: issued.message }, { status: 429 });
    }

    if (channel === "whatsapp") {
      // Existing Buildohub convention: whatsappNumber -> phone fallback (see
      // resolveRecipient() in apps/api/src/notifications/notification.service.ts).
      // The identifier being authenticated IS the number used for delivery —
      // never a different user's whatsappNumber — falling back to the
      // account's own `phone` only when no whatsappNumber is on file.
      const whatsappTarget = existingUser?.whatsappNumber?.trim() || existingUser?.phone?.trim() || identifier;

      const delivery = await deliverOtpViaWhatsApp(issued.challengeId, whatsappTarget, issued.otp);

      if (!delivery.ok) {
        return NextResponse.json(
          { message: delivery.message, code: delivery.code },
          { status: 503 }
        );
      }

      return NextResponse.json({
        ok: true,
        channel: delivery.channel,
        maskedTarget: delivery.maskedTarget,
        message: "We've sent your OTP to WhatsApp.",
      });
    }

    // channel === "email" (explicit fallback)
    const delivery = await deliverOtp(issued.challengeId, { email: identifier }, issued.otp);

    if (!delivery.ok) {
      return NextResponse.json({ message: delivery.message }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      channel: delivery.channel,
      maskedTarget: delivery.maskedTarget,
      message: `We've sent your OTP to your registered email address (${delivery.maskedTarget}).`,
    });
  } catch (error) {
    console.error("send-otp error:", error);
    return NextResponse.json({ message: "Failed to send OTP" }, { status: 400 });
  }
}
