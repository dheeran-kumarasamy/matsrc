import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredCartIdempotencies } from "@/lib/cart-data";

export const dynamic = "force-dynamic";

/**
 * Scheduled Idempotency Cleanup Endpoint
 * Invoked by Vercel Cron according to the schedule in apps/web/vercel.json.
 *
 * Security:
 * Enforces `Authorization: Bearer <CRON_SECRET>` supplied automatically by Vercel Cron.
 * Rejects requests if CRON_SECRET is unconfigured or if the bearer token is invalid.
 *
 * Retention Policy:
 * Enforces a 7-day post-expiry grace period (cutoff = now - 7 days).
 * Because expiresAt = createdAt + 24 hours, records become eligible for deletion
 * approximately 8 days (~192 hours) after creation. Active records are never touched.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[CRON] CRON_SECRET is not configured on server.");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on server" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing cron authorization" },
      { status: 401 }
    );
  }

  try {
    const startTime = Date.now();
    // 7-day post-expiry grace cutoff
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deletedCount = await cleanupExpiredCartIdempotencies(cutoff, undefined, {
      batchSize: 1000,
    });
    const durationMs = Date.now() - startTime;

    console.log(
      `[CRON] cleanup-idempotency pruned ${deletedCount} records in ${durationMs}ms.`
    );

    return NextResponse.json({
      success: true,
      deletedCount,
      cutoff: cutoff.toISOString(),
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[CRON] cleanup-idempotency failed:", error?.message || error);
    return NextResponse.json(
      { error: "Internal server error during idempotency cleanup" },
      { status: 500 }
    );
  }
}

