import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// Backs the registration flow's "Select Role" + "Contact" steps
// (apps/web/app/(auth)/auth/register/page.tsx): persists the chosen
// BUILDER/SUPPLIER role plus the optional WhatsApp number/consent captured
// right after OTP sign-in. Uses resolveUserCtx (falls back to the NextAuth
// session cookie) since this is a plain browser fetch() right after
// signIn("credentials", ...), not an authenticated builderApi* call.
export async function POST(request: Request) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const role = body?.role;
    if (role !== "BUILDER" && role !== "SUPPLIER") {
      return NextResponse.json({ message: "Choose Builder or Supplier." }, { status: 400 });
    }

    const whatsappNumber: string | null = typeof body?.whatsappNumber === "string" ? body.whatsappNumber.trim() || null : null;
    const whatsappConsent = Boolean(body?.whatsappConsent);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        role,
        whatsappNumber,
      },
    });

    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: { whatsappEnabled: whatsappConsent },
      create: {
        userId: user.id,
        whatsappEnabled: whatsappConsent,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("set-role error:", error);
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Please sign in again." }, { status: 401 });
    }
    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "This WhatsApp number is already in use by another account" },
        { status: 409 }
      );
    }
    return NextResponse.json({ message: "Failed to save your details" }, { status: 500 });
  }
}
