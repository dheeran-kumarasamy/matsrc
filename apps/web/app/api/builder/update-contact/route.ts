import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// GET backs the /profile page's initial render: current email/phone plus
// their verification status, and the existing WhatsApp preferences. Added
// alongside the OTP-based contact verification feature so the page can show
// "Verified"/"Unverified" badges without re-deriving them client-side.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const preference = await prisma.notificationPreference.findUnique({ where: { userId: user.id } });

    return NextResponse.json({
      name: user.name,
      email: user.email,
      emailVerified: !!user.emailVerifiedAt,
      phone: user.phone,
      phoneVerified: !!user.phoneVerifiedAt,
      whatsappNumber: user.whatsappNumber,
      whatsappEnabled: preference?.whatsappEnabled ?? true,
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
    }
    console.error("Update-contact GET error:", error);
    return NextResponse.json({ message: "Failed to load contact information" }, { status: 500 });
  }
}

// BUG-08: backs the existing app/(builder)/profile/page.tsx form, which
// previously POSTed to this exact path with nothing behind it (404).
//
// IMPORTANT (contact-verification feature): phone is intentionally NO LONGER
// writable through this route — changing it now requires the OTP flow in
// app/api/builder/profile/contact-verification/* (see task spec §3 "Do not
// immediately replace the currently verified phone number"). This route now
// only updates the WhatsApp notification preferences, which are unrelated
// fields the spec explicitly says must NOT trigger OTP verification (§8
// "Updating unrelated profile fields must not trigger email or phone OTP
// verification").
export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const whatsappNumber: string | null | undefined = body?.whatsappNumber ?? null;
    const whatsappEnabled: boolean = Boolean(body?.whatsappEnabled);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        whatsappNumber: whatsappNumber?.trim() || null,
      },
    });

    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: { whatsappEnabled },
      create: {
        userId: user.id,
        whatsappEnabled,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Update-contact POST error:", error);
    return NextResponse.json({ message: "Failed to update contact information" }, { status: 500 });
  }
}
