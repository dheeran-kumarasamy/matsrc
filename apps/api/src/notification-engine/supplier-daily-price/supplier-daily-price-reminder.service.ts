import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationEngineService } from "../notification-engine.service";
import { SupplierDailyPriceCompletenessService } from "./supplier-daily-price-completeness.service";

// Repository audit (Phase 0) found no standalone "/supplier/pricing" route —
// the actual Buildohub supplier route where suppliers update product prices
// is apps/supplier's existing "/listings" page (see
// apps/supplier/app/(supplier)/listings and
// apps/api/src/whatsapp/flows/price-update.flow.ts, which links suppliers to
// the same route for the identical price-update action). The spec's example
// deep link ("/supplier/pricing") is documented as an assumption deviation
// in the deliverables report — this uses the real existing route instead of
// fabricating a new one.
function supplierPricingDeepLink(): string {
  const baseUrl = process.env.SUPPLIER_PORTAL_URL || process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";
  return `${baseUrl.replace(/\/$/, "")}/listings`;
}

/**
 * SupplierDailyPriceReminderService — Phase 11/12 orchestration.
 *
 * Algorithm (spec Phase 11):
 *   active suppliers -> products requiring daily price updates ->
 *   today's business date -> today's price observations ->
 *   missing products -> if none missing: no notification;
 *   if missing: create NotificationEvent SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED
 *
 * Idempotency: dedupe key is
 * `SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:{supplierId}:{businessDate}` (spec
 * Phase 12), enforced at the database level via
 * `NotificationEvent.dedupeKey`'s unique constraint AND checked explicitly
 * by `NotificationPolicyService.evaluate()` before create, so at most one
 * WhatsApp reminder is ever sent per supplier per business date.
 *
 * Resolution: `resolveIfComplete()` is called after every listing price
 * update (see ListingsService hook) — once a supplier's daily list becomes
 * fully complete, the day's NotificationEvent is marked `resolved`, which
 * both surfaces correctly in Admin and prevents the *next* sweep run within
 * the same business date from re-evaluating/reminding (the dedupe key
 * already blocks a duplicate send regardless, but marking resolved keeps
 * the NotificationEvent's status accurate for reporting).
 */
@Injectable()
export class SupplierDailyPriceReminderService {
  private readonly logger = new Logger(SupplierDailyPriceReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly completeness: SupplierDailyPriceCompletenessService,
    private readonly engine: NotificationEngineService
  ) {}

  private dedupeKey(supplierId: string, businessDate: string): string {
    return `SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:${supplierId}:${businessDate}`;
  }

  async evaluateAndNotify(now: Date = new Date()): Promise<{ evaluated: number; notified: number; skippedComplete: number }> {
    const results = await this.completeness.evaluateAllActiveSuppliers(now);

    let notified = 0;
    let skippedComplete = 0;

    for (const result of results) {
      if (result.missingProducts.length === 0) {
        skippedComplete += 1;
        continue;
      }

      const dedupeKey = this.dedupeKey(result.supplierId, result.businessDate);

      const supplierProfile = await this.prisma.supplierProfile.findUnique({
        where: { id: result.supplierId },
        include: { user: true },
      });
      if (!supplierProfile) continue;

      const phone = supplierProfile.user.whatsappNumber?.trim() || supplierProfile.user.phone?.trim() || null;
      const missingNames = result.missingProducts.map((p) => p.name);
      const preview = missingNames.slice(0, 5).join(", ") + (missingNames.length > 5 ? ` +${missingNames.length - 5} more` : "");

      const dispatchResult = await this.engine.dispatch(
        {
          eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED",
          recipientId: supplierProfile.userId,
          recipientType: "supplier",
          entityType: "SupplierProfile",
          entityId: result.supplierId,
          phone,
          parameters: [supplierProfile.companyName, String(result.missingProducts.length), preview],
          deepLink: supplierPricingDeepLink(),
          title: "Daily Price Update Reminder",
          body: `Your Buildohub price list is missing today's update for: ${preview}. Please update today's prices to keep your products current.`,
          dedupeKey,
          payload: {
            supplierId: result.supplierId,
            businessDate: result.businessDate,
            missingProducts: missingNames,
          },
        },
        "WHATSAPP"
      );

      if (dispatchResult.allowed) {
        notified += 1;
      } else {
        this.logger.debug(
          `Reminder suppressed for supplier=${result.supplierId} businessDate=${result.businessDate} reason=${dispatchResult.reason}`
        );
      }
    }

    return { evaluated: results.length, notified, skippedComplete };
  }

  /**
   * Called after a supplier updates a listing price — checks whether the
   * supplier's daily list is now fully complete and, if so, resolves
   * today's reminder NotificationEvent (if one exists) so it no longer
   * shows as outstanding. Never throws — always best-effort.
   */
  async resolveIfComplete(supplierId: string, now: Date = new Date()): Promise<void> {
    try {
      const result = await this.completeness.evaluateSupplier(supplierId, now);
      if (result.missingProducts.length > 0) {
        return;
      }
      await this.engine.resolve(this.dedupeKey(supplierId, result.businessDate));
    } catch (error) {
      this.logger.warn(
        `resolveIfComplete failed for supplier ${supplierId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
