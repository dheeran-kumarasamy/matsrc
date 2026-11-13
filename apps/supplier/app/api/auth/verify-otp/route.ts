import { NextRequest, NextResponse } from "next/server";
import { prisma, resolveOrLinkIdentity, detectCrossIdentityConflict, resolveCrossRoleSafeEmail } from "@matsrc/db";
import { verifySupplierOtpChallenge, normalizeSupplierPhone } from "@/lib/otp-service";

export const dynamic = "force-dynamic";

// NEW Supplier portal login OTP — verify step. On success, upserts a
// User + SupplierProfile exactly the way apps/supplier/auth.ts's existing
// Google `signIn()` callback already does on first Google sign-in — same
// role ("SUPPLIER"), same SupplierProfile auto-provisioning shape — so OTP
// and Google logins converge on the identical account/session model. This
// route NEVER creates a NextAuth session itself; the client completes
// sign-in via the Credentials provider added to apps/supplier/auth.ts,
// exactly mirroring apps/web's C20 pattern.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const rawChannel = body?.channel;
    const channel: "whatsapp" | "email" = rawChannel === "email" ? "email" : "whatsapp";
    const rawIdentifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
    const otp = typeof body?.otp === "string" ? body.otp : "";

    if (!rawIdentifier) {
      return NextResponse.json({ message: "Missing phone/email." }, { status: 400 });
    }
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ message: "Enter the 6-digit code." }, { status: 400 });
    }

    let identifier: string | null;
    if (channel === "email") {
      identifier = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawIdentifier) ? rawIdentifier.trim().toLowerCase() : null;
    } else {
      identifier = normalizeSupplierPhone(rawIdentifier);
    }
    if (!identifier) {
      return NextResponse.json({ message: "Invalid phone/email." }, { status: 400 });
    }

    const verified = await verifySupplierOtpChallenge(identifier, otp);

    if (!verified.ok) {
      const status = verified.code === "NOT_FOUND" || verified.code === "EXPIRED" ? 400 : 401;
      return NextResponse.json({ message: verified.message }, { status });
    }

    // Unified Account Identity: resolution now goes through AuthIdentity
    // (provider+identifier+role=SUPPLIER) FIRST, fixing the same
    // WhatsApp-placeholder-email vs real-email/Google duplicate-account
    // bug found by the identity audit — Supplier's Google signIn callback
    // (apps/supplier/auth.ts) resolves through the exact same layer, so a
    // Supplier who logs in via WhatsApp and later via Google/Email
    // converges on the SAME SupplierProfile-bearing User instead of a
    // second one.
    //
    // The legacy, Supplier-portal-scoped placeholder email
    // (`{phone}@supplier.phone.buildohub.in`) is preserved ONLY as a
    // fallback `User` lookup/creation key for phone-only logins that have
    // no real email yet — see the pre-existing doc comment above this
    // scheme's introduction for why it must stay disjoint from Buyer's own
    // placeholder namespace. It is never again the primary
    // identity-resolution mechanism.
    const legacyPlaceholderEmail = `${identifier.replace(/\D/g, "")}@supplier.phone.buildohub.in`;

    // CRITICAL: `User.email` is globally unique across BOTH portals/roles,
    // so an email match might actually belong to a BUILDER, not a
    // SUPPLIER — the role check below is what prevents a Supplier login
    // from ever resolving to a Buyer's User (portal/role isolation).
    const legacyMatch =
      channel === "whatsapp"
        ? await prisma.user.findUnique({ where: { email: legacyPlaceholderEmail } })
        : await prisma.user.findUnique({ where: { email: identifier } });
    const legacyCandidate = legacyMatch?.role === "SUPPLIER" ? legacyMatch : null;

    const scope = {
      provider: (channel === "email" ? "EMAIL" : "WHATSAPP") as "EMAIL" | "WHATSAPP",
      providerIdentifier: identifier,
      role: "SUPPLIER" as const,
    };

    // Safety check (Situation 2 from the audit): never silently merge two
    // already-distinct Users — surface a safe conflict instead.
    const conflict = await detectCrossIdentityConflict(prisma as any, scope, legacyCandidate?.id ?? null);
    if (conflict) {
      return NextResponse.json({ message: conflict.message, code: conflict.code }, { status: 409 });
    }

    const resolved = await resolveOrLinkIdentity(prisma as any, scope, {
      candidateUserId: legacyCandidate?.id ?? null,
      createUser: async () => {
        const desiredEmail = channel === "email" ? identifier : legacyPlaceholderEmail;
        const safeEmail = await resolveCrossRoleSafeEmail(prisma as any, desiredEmail, "SUPPLIER");
        const created = await prisma.user.create({
          data: {
            email: safeEmail,
            name: null,
            role: "SUPPLIER",
            phone: channel === "whatsapp" ? identifier : null,
            supplierProfile: {
              create: { companyName: "New Supplier" },
            },
          },
        });
        return { id: created.id };
      },
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: resolved.userId } });

    return NextResponse.json({ ok: true, email: user.email, name: user.name ?? "" });
  } catch (error: any) {
    console.error("supplier verify-otp error:", error);
    const message = error?.message || "Failed to verify OTP";
    return NextResponse.json({ message }, { status: 400 });
  }
}
