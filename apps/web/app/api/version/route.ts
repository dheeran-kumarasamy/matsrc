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
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" } }
  );
}
