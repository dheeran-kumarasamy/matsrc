import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

const ENTITY_TYPE = "WhatsAppLifecycleSend";
const ACTION = "WHATSAPP_LIFECYCLE_DEDUPE";

/**
 * Durable (survives process restarts / multiple instances / cross-day scheduling)
 * idempotency guard for the WhatsApp lifecycle-notification sends.
 *
 * The bot's `WhatsAppSessionService.withIdempotency` is in-memory with a 5-minute TTL —
 * fine for deduping duplicate webhook deliveries within a single supplier chat session,
 * but NOT suitable here: daily supplier digests and the enquiry-nudge sweep must dedupe
 * across days/restarts/concurrent job runs. Rather than adding a new Prisma model, this
 * reuses the existing `AuditLog` table (already the source of truth for all
 * WhatsApp-originated actions, tagged `channel: "whatsapp"") — a dedupe key is recorded
 * as its own indexed `entityId` (via the existing `@@index([entityType, entityId])`)
 * so a lookup is a simple indexed query, no JSON-path filtering required.
 */
@Injectable()
export class WhatsAppLifecycleIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `fn` at most once for a given `dedupeKey`, ever. If a prior send already
   * recorded this key, `fn` is skipped entirely (including no duplicate audit entry) and
   * this resolves to `false`. Uses a DB-level check-then-write; a narrow race window is
   * acceptable here (worst case: one duplicate WhatsApp send under concurrent scheduler
   * runs), the same tradeoff already accepted by `NotificationService.enqueueEnvelope`'s
   * identical check-then-create idempotency pattern.
   */
  async runOnce(dedupeKey: string, fn: () => Promise<void>): Promise<boolean> {
    const existing = await this.prisma.auditLog.findFirst({
      where: { entityType: ENTITY_TYPE, entityId: dedupeKey },
      select: { id: true },
    });

    if (existing) {
      return false;
    }

    await fn();

    await this.prisma.auditLog.create({
      data: {
        actorId: "system",
        action: ACTION,
        entityType: ENTITY_TYPE,
        entityId: dedupeKey,
        metadata: { channel: "whatsapp", dedupeKey },
      },
    });

    return true;
  }
}
