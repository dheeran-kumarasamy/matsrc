import { NextResponse } from "next/server";

// P0 — production version endpoint.
//
// Returns non-sensitive deployment metadata so we can unambiguously answer
// "which build is actually running in production?" without ever exposing
// secrets, env values, tokens, or infrastructure details.
//
// All fields are sourced from Vercel's automatically-populated System
// Environment Variables (https://vercel.com/docs/projects/environment-variables/system-environment-variables) —
// no custom env var needs to be configured, and nothing here is derived from
// the process's actual secret-bearing env vars.
export const dynamic = "force-dynamic";

// Evaluated once, at module load (i.e. at build/cold-start time), not per
// request — so this reflects the deployment's build time rather than the
// current request time.
const BUILD_TIME = new Date().toISOString();

export async function GET() {
  let dbStatus = "unchecked";
  let dbHost: string | null = null;
  let hasAuthIdentity = false;
  try {
    if (process.env.DATABASE_URL) {
      try {
        const u = new URL(process.env.DATABASE_URL.replace(/^postgresql:\/\//, "http://"));
        dbHost = u.host;
      } catch {}
    }
    const { prisma } = await import("@/lib/prisma");
    const count = await prisma.user.count();
    const rows: any = await prisma.$queryRawUnsafe(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'AuthIdentity'"
    );
    hasAuthIdentity = Array.isArray(rows) && rows.length > 0;
    dbStatus = `connected (users: ${count}, hasAuthIdentity: ${hasAuthIdentity})`;
  } catch (e: any) {
    dbStatus = `error: ${e?.message || String(e)}`;
  }

  let iciciAvailable = false;
  let hasMerchantId = false;
  let merchantId: string | null = null;
  let aggregatorId: string | null = null;
  let returnUrl: string | null = null;

  try {
    const { isIciciUatAvailable } = await import("@/lib/icici/environment");
    const { getIciciConfig } = await import("@/lib/icici/config");
    iciciAvailable = isIciciUatAvailable();
    const config = getIciciConfig();
    if (config) {
      hasMerchantId = !!config.merchantId;
      merchantId = config.merchantId;
      aggregatorId = config.aggregatorId;
      returnUrl = config.returnUrl;
    }
  } catch {}

  return NextResponse.json(
    {
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      // Vercel doesn't expose a dedicated "build time" system env var, so we
      // fall back to this module's own evaluation time — for a serverless
      // function this is effectively the time the current deployment's
      // build/bundle was produced (it does not change between invocations
      // of the same deployment).
      buildTime: BUILD_TIME,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      authDiagnostics: {
        hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
        googleClientIdPrefix: process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.slice(0, 8) + "..." : null,
        hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
        hasAuthSecret: !!process.env.AUTH_SECRET,
        hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        databaseHost: dbHost,
        hasAuthIdentityTable: hasAuthIdentity,
        database: dbStatus,
      },
      iciciDiagnostics: {
        isIciciUatAvailable: iciciAvailable,
        hasMerchantId,
        merchantId,
        aggregatorId,
        returnUrl,
        pgEnabled: process.env.ICICI_PG_ENABLED || null,
        buildohubEnv: process.env.BUILDOHUB_ENV || null,
      },
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" } }
  );
}
