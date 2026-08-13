import { NextResponse } from "next/server";

import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { runSourcingTurn } from "@/lib/sourcing/pipeline";
import { checkRateLimit } from "@/lib/sourcing/rate-limit";
import {
  getSession,
  recordToolInvocation,
  saveRecommendations,
  updateSession,
} from "@/lib/sourcing/session-store";
import type { SourcingTurn } from "@/lib/sourcing/types";

export const dynamic = "force-dynamic";

/** Hard cap on a single customer message (prompt-injection/abuse surface). */
const MAX_MESSAGE_LENGTH = 1000;

// One conversational turn of the AI Sourcing Assistant.
//
// SECURITY:
//   - middleware.ts blocks unauthenticated /api/builder/* callers
//   - the session is loaded scoped by userId (404 for anyone else's session)
//   - the message is length-capped and treated strictly as data
//   - per-user rate limiting guards the LLM call
//   - NOTHING consequential happens here: this route only reads data and
//     computes a recommendation. Creating an enquiry requires the separate
//     /confirm route and an explicit customer action (§14).

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const session = await getSession(user.id, params.id);
    if (!session) {
      return NextResponse.json({ message: "Sourcing session not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
    if (!rawMessage) {
      return NextResponse.json({ message: "Please describe what you need." }, { status: 400 });
    }
    const message = rawMessage.slice(0, MAX_MESSAGE_LENGTH);

    const limit = checkRateLimit(user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          message: "You're sending requests too quickly. Please wait a moment and try again.",
          retryAfterMs: limit.retryAfterMs,
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } }
      );
    }

    const started = Date.now();
    const result = await runSourcingTurn({ message, existing: session.requirement });

    // Persist the transcript and the tool snapshots so the session is resumable.
    const conversation: SourcingTurn[] = [
      ...session.conversation,
      { role: "user", content: message, at: new Date().toISOString() },
      { role: "assistant", content: result.message, at: new Date().toISOString() },
    ];

    const status =
      result.stage === "RECOMMENDED"
        ? "RECOMMENDED"
        : result.stage === "COLLECTING"
          ? "COLLECTING"
          : "SEARCHING";

    await updateSession(user.id, session.id, {
      status,
      requirement: result.requirement,
      conversation,
      candidateProducts: result.productSearch?.matches ?? [],
      candidateSuppliers: result.suppliers,
    });

    if (result.options.length > 0) {
      await saveRecommendations(user.id, session.id, result.options);
    }

    // Audit trail (§21): one row summarising this turn. Stores counts/ids, not
    // the full result set, and never any secret.
    await recordToolInvocation({
      userId: user.id,
      sessionId: session.id,
      tool: "parse_requirement",
      input: { messageLength: message.length },
      resultSummary: {
        stage: result.stage,
        requirementSource: result.diagnostics.requirementSource,
        aiFailed: result.diagnostics.aiFailed,
        productMatches: result.productSearch?.matches.length ?? 0,
        supplierCount: result.suppliers.length,
        optionCount: result.options.length,
      },
      status: result.options.length > 0 ? "OK" : "EMPTY",
      latencyMs: Date.now() - started,
    });

    console.log(
      `[sourcing] turn sessionId=${session.id} stage=${result.stage} suppliers=${result.suppliers.length} options=${result.options.length} latencyMs=${result.diagnostics.latencyMs} requirementSource=${result.diagnostics.requirementSource} aiFailed=${result.diagnostics.aiFailed}`
    );

    return NextResponse.json({
      stage: result.stage,
      status,
      requirement: result.requirement,
      message: result.message,
      question: result.question,
      productMatches: result.productSearch?.matches ?? [],
      productAlternatives: result.productSearch?.alternatives ?? [],
      suppliers: result.suppliers,
      options: result.options,
      headline: result.headline,
      awaitingApproval: result.awaitingApproval,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // §24: never expose stack traces or provider internals to the customer.
    console.error("[sourcing] turn failed:", error);
    return NextResponse.json(
      { message: "I couldn't complete that sourcing request. Please try again." },
      { status: 500 }
    );
  }
}
