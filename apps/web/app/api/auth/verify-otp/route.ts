import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// Dev/demo OTP verification — pairs with /api/auth/send-otp (no real OTP
// provider wired up yet, see that route's comment). Accepts any 6-digit
// numeric code and upserts a User row for the identifier so the rest of the
// app (which keys everything off `session.user.email`) has something to
// authenticate against. The client completes the actual sign-in by calling
// next-auth's `signIn("credentials", { email: resolvedEmail, redirect: false })`
// with the `email` this route returns — reusing the existing Credentials
// provider's dev-mode "accept any credentials" authorize() in apps/web/auth.ts
// rather than duplicating session/cookie handling here.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const channel = body?.channel;
    const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
    const otp = typeof body?.otp === "string" ? body.otp : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (channel !== "phone" && channel !== "email") {
      return NextResponse.json({ message: "Choose phone or email." }, { status: 400 });
    }
    if (!identifier) {
      return NextResponse.json({ message: "Missing phone/email." }, { status: 400 });
    }
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ message: "Enter the 6-digit code." }, { status: 400 });
    }

    // The rest of this app resolves the signed-in user by email (see
    // lib/builder-db.ts's getUserCtx/resolveUserCtx and auth.ts's
    // Credentials provider), so a phone-only identifier is mapped to a
    // stable, deterministic placeholder email rather than introducing a
    // second identity key throughout the codebase.
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
  } catch (error) {
    console.error("verify-otp error:", error);
    return NextResponse.json({ message: "Invalid OTP" }, { status: 400 });
  }
}
