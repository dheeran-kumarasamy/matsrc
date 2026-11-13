import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/builder-db";
import { normalizeEmail, isValidEmailFormat, normalizePhone } from "@/lib/contact-verification/validation";
import { verifyOtpChallenge, checkOtpVerifyRateLimit } from "@/lib/otp-service";
import { OtpPurpose, resolveOrLinkIdentity, detectCrossIdentityConflict, resolveCrossRoleSafeEmail } from "@matsrc/db";

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
    const rawChannel = body?.channel;
    // "whatsapp" and the legacy "phone" value are treated identically here —
    // both are a phone-number identifier, normalized the same way, mapped
    // to the same placeholder-email identity scheme below. See
    // /api/auth/send-otp/route.ts for the same alias.
    const channel: "phone" | "email" | null =
      rawChannel === "email" ? "email" : rawChannel === "phone" || rawChannel === "whatsapp" ? "phone" : null;
    const rawIdentifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
    const otp = typeof body?.otp === "string" ? body.otp : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (channel !== "phone" && channel !== "email") {
      return NextResponse.json({ message: "Choose WhatsApp or email." }, { status: 400 });
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

    // Unified Account Identity: resolution now goes through AuthIdentity
    // (provider+identifier+role) FIRST — this is the fix for the
    // WhatsApp-placeholder-email vs real-email duplicate-account bug found
    // by the identity audit. The legacy placeholder email
    // (`{phone}@phone.buildohub.in`) is preserved ONLY as a fallback `User`
    // lookup/creation key for phone-only logins that have no real email yet
    // — it is never again the primary identity-resolution mechanism.
    const legacyPlaceholderEmail = `${identifier.replace(/\D/g, "")}@phone.buildohub.in`;

    // For a phone login, look up any pre-existing User via the legacy
    // placeholder scheme (Situation 1 in the audit: this User already
    // exists from before AuthIdentity existed, or from a previous WhatsApp
    // login that hasn't been backfilled yet) — this is used ONLY as a
    // candidate to link the new AuthIdentity to, never to silently merge
    // with a different real-email User. CRITICAL: `User.email` is
    // globally unique across BOTH portals/roles, so an email match might
    // actually belong to a SUPPLIER, not a BUILDER — the role check below
    // is what prevents a Buyer login from ever resolving to a Supplier's
    // User (portal/role isolation).
    const legacyMatch =
      channel === "phone"
        ? await prisma.user.findUnique({ where: { email: legacyPlaceholderEmail } })
        : await prisma.user.findUnique({ where: { email: identifier } });
    const legacyCandidate = legacyMatch?.role === "BUILDER" ? legacyMatch : null;

    const scope = {
      provider: (channel === "email" ? "EMAIL" : "WHATSAPP") as "EMAIL" | "WHATSAPP",
      providerIdentifier: identifier,
      role: "BUILDER" as const,
    };

    // Safety check (Situation 2 from the audit): if this exact identifier
    // is ALREADY linked to a different User than the legacy candidate we
    // just found, never silently merge — surface a safe conflict instead.
    const conflict = await detectCrossIdentityConflict(prisma as any, scope, legacyCandidate?.id ?? null);
    if (conflict) {
      return NextResponse.json({ message: conflict.message, code: conflict.code }, { status: 409 });
    }

    const resolved = await resolveOrLinkIdentity(
      prisma as any,
      scope,
      {
        candidateUserId: legacyCandidate?.id ?? null,
        createUser: async () => {
          const desiredEmail = channel === "email" ? identifier : legacyPlaceholderEmail;
          const safeEmail = await resolveCrossRoleSafeEmail(prisma as any, desiredEmail, "BUILDER");
          const created = await prisma.user.create({
            data: {
              email: safeEmail,
              name: name || null,
              phone: channel === "phone" ? identifier : null,
              role: "BUILDER",
            },
          });
          return { id: created.id };
        },
      }
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { id: resolved.userId } });

    if (name && user.name !== name) {
      await prisma.user.update({ where: { id: user.id }, data: { name } });
    }

    return NextResponse.json({ ok: true, email: user.email, name: name || user.name || "" });
  } catch (error: any) {
    console.error("verify-otp error:", error);
    const message = error?.message || "Failed to verify OTP";
    return NextResponse.json({ message }, { status: 400 });
  }
}
