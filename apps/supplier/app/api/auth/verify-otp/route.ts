import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@matsrc/db";
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

    // Pre-live-review correction: apps/web (Buyer) and apps/supplier share
    // the SAME production User table (unique on `email`). Buyer's
    // verify-otp route independently derives a placeholder email for a
    // phone-only login as `{phone}@phone.buildohub.in`. Using that EXACT
    // same scheme here caused a real, live-tested cross-portal identity
    // collision: a phone number that logged into Buyer first silently
    // merged into that existing BUILDER-role row on Supplier login
    // (prisma.user.upsert() hit `update: {}` instead of `create`), so
    // Supplier's SupplierProfile was never provisioned and role stayed
    // BUILDER. Using a SUPPLIER-portal-specific namespace
    // (`@supplier.phone.buildohub.in`) guarantees Supplier's phone-only
    // identity is always disjoint from Buyer's for the same phone number,
    // matching the task's requirement to "preserve existing account lookup"
    // and "separate login from registration behavior" without merging two
    // different portals' identities for the same real-world phone number.
    const email = channel === "email" ? identifier : `${identifier.replace(/\D/g, "")}@supplier.phone.buildohub.in`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: null,
        role: "SUPPLIER",
        phone: channel === "whatsapp" ? identifier : null,
        supplierProfile: {
          create: { companyName: "New Supplier" },
        },
      },
      include: { supplierProfile: true },
    });

    return NextResponse.json({ ok: true, email: user.email, name: user.name ?? "" });
  } catch (error: any) {
    console.error("supplier verify-otp error:", error);
    const message = error?.message || "Failed to verify OTP";
    return NextResponse.json({ message }, { status: 400 });
  }
}
