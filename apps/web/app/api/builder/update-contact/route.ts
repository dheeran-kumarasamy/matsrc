import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// BUG-08: backs the existing app/(builder)/profile/page.tsx form, which
// previously POSTed to this exact path with nothing behind it (404). Updates
// the builder's phone/WhatsApp contact details and persists the WhatsApp
// notification opt-in on the related NotificationPreference row (created on
// first use via upsert, since it's an optional 1:1 relation on User).
export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const phone: string | undefined = body?.phone;
    const whatsappNumber: string | null | undefined = body?.whatsappNumber ?? null;
    const whatsappEnabled: boolean = Boolean(body?.whatsappEnabled);

    if (!phone || !phone.trim()) {
      return NextResponse.json({ message: "Phone number is required" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        phone: phone.trim(),
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
    // Prisma unique constraint on User.phone — surface a clean message
    // instead of a raw 500 when another account already uses this number.
    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "This phone number is already in use by another account" },
        { status: 409 }
      );
    }
    return NextResponse.json({ message: "Failed to update contact information" }, { status: 500 });
  }
}
