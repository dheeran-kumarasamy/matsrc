import { NextRequest, NextResponse } from "next/server";

// Dev/demo OTP "send" endpoint — this app has no real SMS/WhatsApp/email OTP
// provider wired up yet (mirrors the existing dev-mode note on
// /api/auth/verify-mfa), so this only validates the request shape and lets
// the client move to the "enter code" step. Any 6-digit code is accepted by
// /api/auth/verify-otp. Swap this for a real OTP provider before production.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const channel = body?.channel;
    const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";

    if (channel !== "phone" && channel !== "email") {
      return NextResponse.json({ message: "Choose phone or email." }, { status: 400 });
    }
    if (!identifier) {
      return NextResponse.json(
        { message: channel === "phone" ? "Enter your phone number." : "Enter your email address." },
        { status: 400 }
      );
    }

    console.log(`[dev-otp] OTP requested for ${channel}:${identifier} — enter any 6-digit code to continue.`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("send-otp error:", error);
    return NextResponse.json({ message: "Failed to send OTP" }, { status: 400 });
  }
}
