import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const otp = String(body?.otp ?? "");

    // Demo OTP validation for local auth flow.
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ message: "Invalid OTP format" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Invalid request" }, { status: 400 });
  }
}
