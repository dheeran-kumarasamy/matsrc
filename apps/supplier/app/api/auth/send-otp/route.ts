import { NextRequest, NextResponse } from "next/server";
import { prisma, Role, findIdentity } from "@matsrc/db";
import {
  issueSupplierOtpChallenge,
  deliverSupplierOtpViaWhatsApp,
  deliverSupplierOtpViaEmail,
  normalizeSupplierPhone,
  checkSupplierOtpSendRateLimit,
} from "@/lib/otp-service";

export const dynamic = "force-dynamic";

// NEW Supplier portal login OTP — send step (WhatsApp primary, email
// explicit fallback). Mirrors apps/web/app/api/auth/send-otp/route.ts's
// structure/behavior exactly, adapted to apps/supplier's own prisma import
// convention and the Supplier (not Builder) role. Does NOT touch Google
// login (apps/supplier/auth.ts's Google provider/signIn callback are
// completely separate and unmodified).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const rawChannel = body?.channel;
    const channel: "whatsapp" | "email" = rawChannel === "email" ? "email" : "whatsapp";
    const rawIdentifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";

    if (!rawIdentifier) {
      return NextResponse.json(
        { message: channel === "whatsapp" ? "Enter your WhatsApp number." : "Enter your email address." },
        { status: 400 }
      );
    }

    // Parity correction with apps/web/app/api/auth/send-otp/route.ts's
    // identical checkOtpSendRateLimit(ip) call — see the doc comment on
    // checkSupplierOtpSendRateLimit() in lib/otp-service.ts.
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
    const ipLimit = checkSupplierOtpSendRateLimit(ip);
    if (!ipLimit.allowed) {
      return NextResponse.json({ message: "Too many OTP requests. Please try again later." }, { status: 429 });
    }

    let identifier: string | null;
    if (channel === "email") {
      identifier = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawIdentifier) ? rawIdentifier.trim().toLowerCase() : null;
    } else {
      identifier = normalizeSupplierPhone(rawIdentifier);
    }
    if (!identifier) {
      return NextResponse.json(
        { message: channel === "whatsapp" ? "Enter a valid WhatsApp number." : "Enter a valid email address." },
        { status: 400 }
      );
    }

    // Unified Account Identity: prefer the AuthIdentity lookup (provider +
    // identifier + role=SUPPLIER) so a previously-linked WhatsApp/email/
    // Google identity resolves to its User even if that User's legacy
    // `phone` field was never populated/backfilled. Falls back to the
    // pre-existing lookups for Users not yet linked into AuthIdentity —
    // this is read-only here (send-otp never creates or links identities
    // itself; only verify-otp does).
    //
    // NOTE: `phone` is intentionally NOT a unique field (see schema.prisma
    // comment — the same phone number can now legitimately belong to both
    // a Buyer and a Supplier account, keyed by their distinct portal-scoped
    // emails) — findFirst(), not findUnique(), is required here. Scoped to
    // role: SUPPLIER so this never matches a Buyer account with the same
    // phone number.
    const linkedIdentity = await findIdentity(prisma as any, {
      provider: channel === "email" ? "EMAIL" : "WHATSAPP",
      providerIdentifier: identifier,
      role: "SUPPLIER",
    });
    const existingUser = linkedIdentity
      ? await prisma.user.findUnique({ where: { id: linkedIdentity.userId } })
      : channel === "email"
        ? await prisma.user.findUnique({ where: { email: identifier } })
        : await prisma.user.findFirst({ where: { phone: identifier, role: Role.SUPPLIER } });

    const issued = await issueSupplierOtpChallenge({
      identifier,
      userId: existingUser?.id ?? null,
      defaultChannel: channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
    });

    if (!issued.ok) {
      return NextResponse.json({ message: issued.message }, { status: 429 });
    }

    if (channel === "whatsapp") {
      const whatsappTarget = existingUser?.whatsappNumber?.trim() || existingUser?.phone?.trim() || identifier;
      const delivery = await deliverSupplierOtpViaWhatsApp(issued.challengeId, whatsappTarget, issued.otp);

      if (!delivery.ok) {
        return NextResponse.json({ message: delivery.message, code: delivery.code }, { status: 503 });
      }

      return NextResponse.json({
        ok: true,
        channel: delivery.channel,
        maskedTarget: delivery.maskedTarget,
        message: "We've sent your OTP to WhatsApp.",
      });
    }

    const delivery = await deliverSupplierOtpViaEmail(issued.challengeId, identifier, issued.otp);
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
    console.error("supplier send-otp error:", error);
    return NextResponse.json({ message: "Failed to send OTP" }, { status: 400 });
  }
}
