import { Injectable, Logger } from "@nestjs/common";
import { KycStatus, Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { buildDailyPriceDedupeKey, parseDailyPricePayload } from "./supplier-daily-price.util";

export type SupplierPriceCompletenessResult = {
  supplierId: string;
  businessDate: string; // YYYY-MM-DD
  missingProducts: Array<{ id: string; name: string }>;
  totalRequired: number;
  totalUpdatedToday: number;
};

/**
 * Determines actual supplier daily price-list completeness (spec Phase 11 —
 * deliberately NOT a generic "send reminder every day" job).
 *
 * "Active suppliers" = SupplierProfile whose linked User has role SUPPLIER
 * and kycStatus APPROVED (the existing Buildohub definition of an
 * onboarded, operational supplier — see AdminContextService/VendorsService).
 *
 * "Products requiring daily price updates" = the supplier's currently
 * active (`isActive: true`) listings (`Product` rows) — Buildohub has no
 * separate "requires daily update" flag on Product today (confirmed during
 * Phase 0 repository audit), so every active listing is treated as
 * requiring a fresh same-day price confirmation. This is documented as an
 * assumption in the deliverables report rather than fabricating a new
 * schema field.
 *
 * "Today's price observations/updates" = `PriceSnapshot` rows (the existing
 * append-only price-discovery time series written by
 * `ListingsService.create`/`update` — see schema comment on
 * `PriceSnapshotSource`) captured for that product on the current UTC
 * business date. A supplier who explicitly re-saves today's price (even to
 * the same value) always creates a new PriceSnapshot row, so this is a
 * reliable "did the supplier touch this listing's price today" signal
 * without inventing a new column.
 *
 * Supplier Daily Price Update enhancement — a product also counts as
 * accounted for when the supplier has explicitly CONFIRMed (not merely
 * previewed) a `SAME` (price-unchanged) acknowledgement for it on this
 * exact business date. Per the confirmed product decision, a `SAME`
 * confirmation deliberately never creates a `PriceSnapshot` row (that would
 * misrepresent an explicit "no change" as a genuine repricing event in the
 * price-discovery time series), so this service reads that confirmation
 * from the same `NotificationEvent` row that already acts as today's
 * price-update "session" (`payload.confirmedSameProductIds` — see
 * SupplierDailyPriceReplyFlow.handleConfirm) rather than faking a snapshot
 * or mutating `basePrice` to satisfy this check. An UNCONFIRMED (merely
 * previewed) `SAME` line must never satisfy completeness — only
 * `confirmedSameProductIds`, written exclusively at CONFIRM time, is
 * consulted here.
 */
@Injectable()
export class SupplierDailyPriceCompletenessService {
  private readonly logger = new Logger(SupplierDailyPriceCompletenessService.name);

  constructor(private readonly prisma: PrismaService) {}

  getBusinessDateKey(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
  }

  async findActiveSupplierIds(): Promise<string[]> {
    const suppliers = await this.prisma.supplierProfile.findMany({
      where: { user: { role: Role.SUPPLIER, kycStatus: KycStatus.APPROVED } },
      select: { id: true },
    });
    return suppliers.map((s) => s.id);
  }

  async evaluateSupplier(supplierId: string, now: Date = new Date()): Promise<SupplierPriceCompletenessResult> {
    const businessDate = this.getBusinessDateKey(now);
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const requiredProducts = await this.prisma.product.findMany({
      where: { supplierId, isActive: true },
      select: { id: true, name: true },
    });

    if (requiredProducts.length === 0) {
      return { supplierId, businessDate, missingProducts: [], totalRequired: 0, totalUpdatedToday: 0 };
    }

    const updatedToday = await this.prisma.priceSnapshot.findMany({
      where: {
        supplierId,
        productId: { in: requiredProducts.map((p) => p.id) },
        capturedAt: { gte: startOfDay, lt: endOfDay },
      },
      select: { productId: true },
      distinct: ["productId"],
    });

    const updatedProductIds = new Set(updatedToday.map((row) => row.productId));

    // Confirmed SAME acknowledgements for THIS exact business date — read
    // from the matching NotificationEvent row (the existing daily
    // price-update "session"), never from a different day's row. A
    // business-date rollover creates a brand-new NotificationEvent (fresh
    // dedupeKey), so yesterday's confirmedSameProductIds can never leak
    // into today's completeness check even though the lookup is keyed only
    // by dedupeKey, not by a separate date comparison.
    const dedupeKey = buildDailyPriceDedupeKey(supplierId, businessDate);
    const sessionEvent = await this.prisma.notificationEvent.findUnique({
      where: { dedupeKey },
      select: { payload: true },
    });
    const confirmedSameProductIds = new Set(parseDailyPricePayload(sessionEvent?.payload).confirmedSameProductIds ?? []);

    const missingProducts = requiredProducts.filter(
      (product) => !updatedProductIds.has(product.id) && !confirmedSameProductIds.has(product.id)
    );

    return {
      supplierId,
      businessDate,
      missingProducts: missingProducts.map((p) => ({ id: p.id, name: p.name })),
      totalRequired: requiredProducts.length,
      totalUpdatedToday: updatedProductIds.size,
    };
  }

  async evaluateAllActiveSuppliers(now: Date = new Date()): Promise<SupplierPriceCompletenessResult[]> {
    const supplierIds = await this.findActiveSupplierIds();
    const results: SupplierPriceCompletenessResult[] = [];
    for (const supplierId of supplierIds) {
      try {
        results.push(await this.evaluateSupplier(supplierId, now));
      } catch (error) {
        this.logger.warn(
          `evaluateSupplier failed for supplier ${supplierId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return results;
  }
}
