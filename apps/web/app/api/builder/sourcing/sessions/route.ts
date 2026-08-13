import { NextResponse } from "next/server";

import { getOrCreateBuilder, getUserCtx, prisma } from "@/lib/builder-db";
import { createSession, listSessions } from "@/lib/sourcing/session-store";

export const dynamic = "force-dynamic";

// AI Sourcing Assistant — session collection.
//
// AUTH: /api/builder/* is rejected for unauthenticated callers by
// middleware.ts before reaching here; getUserCtx() then throws if the custom
// X-User-* headers are absent, which the try/catch turns into a 401. This is
// the same pattern every other builder route in this app uses.
//
// Sessions are always created for, and listed for, the AUTHENTICATED user —
// the client cannot pass a userId.

export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const sessions = await listSessions(user.id);

    return NextResponse.json(
      sessions.map((session) => ({
        id: session.id,
        status: session.status,
        requirement: session.requirement,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
      }))
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    console.error("[sourcing] session list failed:", error);
    return NextResponse.json({ message: "Failed to load sourcing sessions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const body = (await request.json().catch(() => ({}))) as { siteId?: unknown };
    // Only a string is accepted; createSession additionally verifies the Site
    // actually belongs to this builder before tagging the session with it.
    const siteId = typeof body.siteId === "string" && body.siteId.trim() ? body.siteId.trim() : null;

    const session = await createSession(user.id, siteId);

    console.log(`[sourcing] session_created sessionId=${session.id}`);

    return NextResponse.json(
      {
        id: session.id,
        status: session.status,
        requirement: session.requirement,
        conversation: session.conversation,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    console.error("[sourcing] session create failed:", error);
    return NextResponse.json({ message: "Failed to start a sourcing session" }, { status: 500 });
  }
}
