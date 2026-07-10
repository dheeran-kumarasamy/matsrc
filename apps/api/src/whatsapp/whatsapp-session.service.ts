import { Injectable } from "@nestjs/common";
import {
  MAX_INVALID_RETRIES,
  MainFlow,
  SESSION_IDLE_TIMEOUT_MS,
  WhatsAppSession,
} from "./whatsapp.types";

/**
 * Server-side session/context store keyed by phone number (not by any WhatsApp-native
 * session concept). Also doubles as:
 *  - a short-lived idempotency cache for mutating actions (per action key), so duplicate
 *    webhook deliveries from WhatsApp retries don't double-apply a price change/decision/
 *    status update.
 *  - a simple per-supplier-per-minute rate limiter for price-update and enquiry-decision
 *    actions, guarding against fat-finger loops / accidental double submits.
 *
 * In-memory Map is sufficient for a single-instance deployment; swap for Redis (the repo
 * already depends on ioredis for BullMQ) if horizontal scaling is needed later.
 */
@Injectable()
export class WhatsAppSessionService {
  private readonly sessions = new Map<string, WhatsAppSession>();
  private readonly idempotencyCache = new Map<string, { result: unknown; expiresAt: number }>();
  private readonly rateLimitBuckets = new Map<string, number[]>();

  private static readonly IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
  private static readonly RATE_LIMIT_WINDOW_MS = 60 * 1000;
  private static readonly RATE_LIMIT_MAX_ACTIONS = 5;

  get(phone: string): WhatsAppSession | undefined {
    const session = this.sessions.get(phone);
    if (!session) return undefined;

    if (Date.now() - session.updatedAt > SESSION_IDLE_TIMEOUT_MS) {
      this.sessions.delete(phone);
      return undefined;
    }

    return session;
  }

  create(params: {
    phone: string;
    userId: string;
    email?: string | null;
    name?: string | null;
    supplierProfileId: string;
    language?: "en" | "regional";
  }): WhatsAppSession {
    const now = Date.now();
    const session: WhatsAppSession = {
      phone: params.phone,
      userId: params.userId,
      email: params.email ?? null,
      name: params.name ?? null,
      supplierProfileId: params.supplierProfileId,
      language: params.language ?? "en",
      flow: "MAIN",
      step: "MAIN_MENU",
      context: {},
      invalidCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(params.phone, session);
    return session;
  }


  update(phone: string, patch: Partial<Pick<WhatsAppSession, "flow" | "step" | "context" | "invalidCount" | "language">>): WhatsAppSession | undefined {
    const session = this.get(phone);
    if (!session) return undefined;

    const updated: WhatsAppSession = {
      ...session,
      ...patch,
      context: patch.context ?? session.context,
      updatedAt: Date.now(),
    };
    this.sessions.set(phone, updated);
    return updated;
  }

  resetToMainMenu(phone: string): WhatsAppSession | undefined {
    return this.update(phone, { flow: "MAIN", step: "MAIN_MENU", context: {}, invalidCount: 0 });
  }

  setFlow(phone: string, flow: MainFlow, step: string, context: Record<string, unknown> = {}): WhatsAppSession | undefined {
    return this.update(phone, { flow, step, context, invalidCount: 0 });
  }

  incrementInvalid(phone: string): number {
    const session = this.get(phone);
    if (!session) return 0;
    const invalidCount = session.invalidCount + 1;
    this.update(phone, { invalidCount });
    return invalidCount;
  }

  hasExceededRetries(phone: string): boolean {
    const session = this.get(phone);
    return !!session && session.invalidCount >= MAX_INVALID_RETRIES;
  }

  destroy(phone: string): void {
    this.sessions.delete(phone);
  }

  // ─────────────────────────────────────────────
  // Idempotency (survive duplicate webhook deliveries)
  // ─────────────────────────────────────────────

  async withIdempotency<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.sweepIdempotencyCache();
    const cached = this.idempotencyCache.get(key);
    if (cached) {
      return cached.result as T;
    }

    const result = await fn();
    this.idempotencyCache.set(key, {
      result,
      expiresAt: Date.now() + WhatsAppSessionService.IDEMPOTENCY_TTL_MS,
    });
    return result;
  }

  private sweepIdempotencyCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.idempotencyCache) {
      if (entry.expiresAt < now) {
        this.idempotencyCache.delete(key);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Rate limiting
  // ─────────────────────────────────────────────

  isRateLimited(phone: string): boolean {
    const now = Date.now();
    const bucket = (this.rateLimitBuckets.get(phone) ?? []).filter(
      (timestamp) => now - timestamp < WhatsAppSessionService.RATE_LIMIT_WINDOW_MS
    );

    if (bucket.length >= WhatsAppSessionService.RATE_LIMIT_MAX_ACTIONS) {
      this.rateLimitBuckets.set(phone, bucket);
      return true;
    }

    bucket.push(now);
    this.rateLimitBuckets.set(phone, bucket);
    return false;
  }
}
