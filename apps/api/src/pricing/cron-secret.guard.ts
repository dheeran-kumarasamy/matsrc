import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

/**
 * Guards the pricing cron-trigger endpoints (see pricing-cron.controller.ts).
 *
 * WHY THIS EXISTS: apps/api is deployed to Vercel as a serverless function
 * (see apps/api/api/index.ts / apps/api/vercel.json) — there is no
 * long-lived Node process for @nestjs/schedule's @Cron decorators
 * (PricingSchedulerService) to fire on. Vercel Cron Jobs (configured in
 * apps/api/vercel.json's `crons` array) are the serverless-compatible
 * replacement: they make a real HTTP request on a schedule instead of
 * relying on an in-process timer.
 *
 * Vercel automatically sends the project's CRON_SECRET env var as an
 * `Authorization: Bearer <CRON_SECRET>` header on every cron invocation
 * (see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * This guard checks that header against the same env var so these
 * endpoints can only ever be triggered by Vercel's cron dispatcher (or an
 * operator who has the secret), never by an arbitrary public request —
 * fails closed (rejects) if CRON_SECRET is not configured at all, rather
 * than silently allowing unauthenticated triggering.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const expected = process.env.CRON_SECRET;

    if (!expected) {
      throw new UnauthorizedException("CRON_SECRET is not configured — refusing to run pricing cron endpoint.");
    }

    const authHeader = request.headers?.authorization;
    if (authHeader !== `Bearer ${expected}`) {
      throw new UnauthorizedException("Invalid or missing cron authorization.");
    }

    return true;
  }
}
