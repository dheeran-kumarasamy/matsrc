import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import {
  initiateContactChange,
  cancelContactChange,
  getPendingStatus,
} from "@/lib/contact-verification/service";
import type { ContactVerificationChannel } from "@matsrc/db";

export const dynamic = "force-dynamic";

// Backs the /profile page's "change email"/"change phone" OTP flow.
//   GET    -> current pending-verification status for a channel (resume UI after reload)
//   POST   -> start (or resend) an OTP for a new email/phone value
//   DELETE -> cancel a pending change; existing verified contact is left untouched
//
// All operations are scoped to the authenticated caller only (getUserCtx
// throws for unauthenticated requests, and getOrCreateBuilder resolves the
// User row strictly by the session-derived id/email) — one user can never
// initiate, view, or cancel another user's pending contact change.

function parseChannel(value: string | null): ContactVerificationChannel | null {
  if (value === "EMAIL" || value === "PHONE") return value;
  return null;
}

export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const url = new URL(request.url);
    const channel = parseChannel(url.searchParams.get("channel"));
    if (!channel) {
      return NextResponse.json({ message: "Invalid channel" }, { status: 400 });
    }

    const status = await getPendingStatus(user.id, channel);
    return NextResponse.json(status);
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
    }
    console.error("contact-verification GET error:", error);
    return NextResponse.json({ message: "Failed to load verification status" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const channel = parseChannel(body?.channel ?? null);
    const value = typeof body?.value === "string" ? body.value : "";

    if (!channel) {
      return NextResponse.json({ message: "Invalid channel" }, { status: 400 });
    }
    if (!value.trim()) {
      return NextResponse.json({ message: "Enter a value" }, { status: 400 });
    }

    const result = await initiateContactChange(user.id, channel, value);
    if (!result.ok) {
      const status = result.code === "COOLDOWN" || result.code === "RATE_LIMITED" ? 429 : result.code === "CONFLICT" ? 409 : 400;
      return NextResponse.json({ message: result.message, code: result.code, retryAfterMs: result.retryAfterMs }, { status });
    }

    return NextResponse.json({
      ok: true,
      maskedTarget: result.maskedTarget,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
    }
    console.error("contact-verification POST error:", error);
    return NextResponse.json({ message: "Failed to send verification code" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const url = new URL(request.url);
    const channel = parseChannel(url.searchParams.get("channel"));
    if (!channel) {
      return NextResponse.json({ message: "Invalid channel" }, { status: 400 });
    }

    await cancelContactChange(user.id, channel);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
    }
    console.error("contact-verification DELETE error:", error);
    return NextResponse.json({ message: "Failed to cancel verification" }, { status: 500 });
  }
}
