// packages/db/lib/order-confirmation-snapshot.ts
//
// Product-Level GST / GST-Inclusive Buyer Payable — the shared,
// database-reading orchestration layer that composes gst-rate-resolution.ts
// and order-payable-calculation.ts into the single snapshot every
// supplier-confirmation call site must freeze onto Order/OrderItem at the
// exact moment PLACED -> PROCESSING happens. Used by BOTH:
//   - apps/api/src/supplier/rfqs/best-price-selection.service.ts
//     (selectAndFinalizeIfEligible — multi-supplier RFQ auto-confirmation)
//   - apps/supplier/lib/supplier-data.ts
//     (updateSupplierOrderStatus — single-supplier "Confirm Enquiry")
// so there is exactly ONE place this composition happens, never
// duplicated per call site.
//
// Markup is NOT re-resolved here — both existing call sites already
// resolve markup via resolveMarkupForProduct (markup-calculation.ts)
// BEFORE this module runs, producing the buyerUnitPrice/markupPercent/
// markupAmount this module's callers pass in as `markupPercent`.
// Re-resolving markup a second time here would risk two independent reads
// drifting apart within the same confirmation and would violate "apply
// markup exactly once" — this module only ever derives the buyer value
// from the ALREADY-resolved markupPercent, never invents a second one.
//
// STRICT CONTRACT for GST (unlike markup's existing "fail safe to 0%"
// policy, left entirely unchanged by this module): if ANY required line's
// effective GST rate is unresolved, this function returns
// `{ ok: false, errors }` — the caller MUST abort confirmation entirely,
// writing nothing, rather than defaulting to 0%/18%/any other invented
// rate. See TaxSetting's and gst-rate-resolution.ts's own doc comments.
//
// This module reads TaxSetting/AdvanceConfig configuration rows ONLY — it
// never reads or writes Order/OrderItem itself. Callers remain responsible
// for the actual Order/OrderItem persistence, inside their own
// transaction, using the snapshot this module returns.

import { resolveGstRate, resolveGstRateForProduct, type TaxSettingTxClient } from "./gst-rate-resolution";
import {
  calculateOrderPayableTotals,
  calculateRequiredAdvanceAmount,
  type OrderPayableLineResult,
} from "./order-payable-calculation";
import { roundCurrency } from "./gst-calculation";

export type ConfirmationSnapshotTxClient = TaxSettingTxClient & {
  advanceConfig: {
    findUnique: (args: any) => Promise<{ percentage: unknown; isEnabled: boolean } | null>;
  };
};

export type ConfirmationLineRequest = {
  lineItemId: string;
  productId: string;
  categoryId: string;
  /** Original, never-overwritten supplier unit price (pre-markup). */
  supplierUnitPrice: number;
  /** Already-resolved markup percentage (see this module's top doc comment). */
  markupPercent: number;
  quantity: number;
};

export type ConfirmationSnapshotLine = OrderPayableLineResult & { lineItemId: string };

export type OrderConfirmationSnapshot = {
  lines: ConfirmationSnapshotLine[];
  subtotal: number;
  taxAmount: number;
  finalPayableAmount: number;
  advancePercent: number | null;
  requiredAdvanceAmount: number | null;
};

export type ConfirmationSnapshotLineError = {
  lineItemId: string;
  productId: string;
  reason: "NO_SETTING_CONFIGURED" | "ALL_CONFIGURED_SETTINGS_DISABLED_OR_INVALID";
};

export type ConfirmationSnapshotResolution =
  | { ok: true; snapshot: OrderConfirmationSnapshot }
  | { ok: false; errors: ConfirmationSnapshotLineError[] };

/**
 * Resolves GST for every line (using the already-resolved markupPercent
 * passed in by the caller — see this module's top doc comment), then
 * computes the full order-level payable snapshot via
 * calculateOrderPayableTotals (which itself applies markup via
 * calculateMarkup and GST on the resulting marked-up buyer value — see
 * order-payable-calculation.ts).
 *
 * GST resolution NEVER fails safe: any line with an unresolved GST rate is
 * collected into `errors`, and once every line has been checked, the
 * function returns `{ ok: false, errors }` — never a partial snapshot. The
 * caller must then abort the entire confirmation, writing nothing.
 */
export async function resolveOrderConfirmationSnapshot(
  tx: ConfirmationSnapshotTxClient,
  lines: ConfirmationLineRequest[]
): Promise<ConfirmationSnapshotResolution> {
  const errors: ConfirmationSnapshotLineError[] = [];
  const lineInputs: Array<{
    lineItemId: string;
    supplierUnitPrice: number;
    markupPercent: number;
    taxRatePercent: number;
    quantity: number;
  }> = [];

  for (const line of lines) {
    const gst = await resolveGstRateForProduct(tx, { productId: line.productId, categoryId: line.categoryId });

    if (!gst.resolved) {
      errors.push({ lineItemId: line.lineItemId, productId: line.productId, reason: gst.reason });
      continue;
    }

    lineInputs.push({
      lineItemId: line.lineItemId,
      supplierUnitPrice: line.supplierUnitPrice,
      markupPercent: line.markupPercent,
      taxRatePercent: gst.percentage,
      quantity: line.quantity,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const totals = calculateOrderPayableTotals(lineInputs);
  const snapshotLines: ConfirmationSnapshotLine[] = totals.lines.map((computed, index) => ({
    ...computed,
    lineItemId: lineInputs[index].lineItemId,
  }));

  const advanceConfig = await tx.advanceConfig.findUnique({ where: { id: "global" } });
  const advancePercent = advanceConfig && advanceConfig.isEnabled ? Number(advanceConfig.percentage) : null;
  const requiredAdvanceAmount = calculateRequiredAdvanceAmount(totals.finalPayableAmount, advancePercent);

  return {
    ok: true,
    snapshot: {
      lines: snapshotLines,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      finalPayableAmount: totals.finalPayableAmount,
      advancePercent,
      requiredAdvanceAmount,
    },
  };
}

/**
 * Re-exported for convenience so callers that only need to validate GST
 * resolvability (e.g. a pre-flight check before even opening a
 * transaction) do not need a second import. Pure — no DB access.
 */
export { resolveGstRate };

// ─────────────────────────────────────────────
// Legacy/retry safety — shared by both confirmation call sites so a retry
// (duplicate webhook delivery, double-click, re-run) can never silently
// recompute/overwrite an already-frozen snapshot, and a corrupted/partial
// snapshot is never silently "repaired" by just writing over it again.
// ─────────────────────────────────────────────

export type OrderSnapshotFields = {
  taxAmount: number | null;
  finalPayableAmount: number | null;
  advancePercent: number | null;
  requiredAdvanceAmount: number | null;
};

/** Thrown when an Order's snapshot fields are partially populated in a way
 * that violates the documented invariants (see Order.taxAmount's schema
 * doc comment: "All four fields below are set together or not at all").
 * Callers MUST surface this as a blocking error — NEVER silently repair
 * financial history by recomputing and overwriting. */
export class InconsistentOrderSnapshotError extends Error {
  constructor(orderId: string, detail: string) {
    super(`Order ${orderId} has an inconsistent financial snapshot: ${detail}`);
    this.name = "InconsistentOrderSnapshotError";
  }
}

/**
 * Validates the documented Order-snapshot invariants:
 *   - taxAmount/finalPayableAmount: both null, or both non-null.
 *   - advancePercent/requiredAdvanceAmount: both null, or both non-null.
 *   - advancePercent can only be non-null when finalPayableAmount is also
 *     non-null (an advance amount can never exist without a payable it was
 *     derived from).
 * Throws InconsistentOrderSnapshotError on any violation — never attempts
 * to guess/repair the correct value.
 */
export function assertConsistentOrderSnapshot(orderId: string, fields: OrderSnapshotFields): void {
  const taxSet = fields.taxAmount !== null;
  const payableSet = fields.finalPayableAmount !== null;
  if (taxSet !== payableSet) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `taxAmount (${fields.taxAmount}) and finalPayableAmount (${fields.finalPayableAmount}) must be both null or both set.`
    );
  }

  const advancePercentSet = fields.advancePercent !== null;
  const requiredAdvanceSet = fields.requiredAdvanceAmount !== null;
  if (advancePercentSet !== requiredAdvanceSet) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `advancePercent (${fields.advancePercent}) and requiredAdvanceAmount (${fields.requiredAdvanceAmount}) must be both null or both set.`
    );
  }

  if (advancePercentSet && !payableSet) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `advancePercent (${fields.advancePercent}) is set but finalPayableAmount is null — an advance amount cannot exist without a payable it was derived from.`
    );
  }
}

/** True when the Order already carries a complete, confirmed financial
 * snapshot — callers MUST treat this as "already confirmed, do not
 * recompute" and return the existing values as-is. */
export function hasCompleteOrderSnapshot(fields: OrderSnapshotFields): boolean {
  return fields.taxAmount !== null && fields.finalPayableAmount !== null;
}

/**
 * Thrown by a confirmation transaction's concurrency guard (a conditional
 * `updateMany` keyed on the order still being in its pre-confirmation
 * state) when it affects zero rows — meaning a concurrent request already
 * won the confirmation transition between this request's initial read and
 * its write. Callers MUST catch this, re-read the (now-finalized-by-the-
 * other-request) order fresh, and return that existing result rather than
 * retrying the write or surfacing a generic error — mirrors the existing
 * `quoteSelectionCompletedAt` idempotency check's intent, just made safe
 * under genuine concurrency rather than only under sequential retries.
 */
export class ConcurrentConfirmationLostError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} was confirmed by a concurrent request; this request lost the race.`);
    this.name = "ConcurrentConfirmationLostError";
  }
}

// ─────────────────────────────────────────────
// Arithmetic-consistency validation (Phase 4.2) — strengthens
// assertConsistentOrderSnapshot's NULLNESS-only checks above with actual
// NUMERIC reconciliation against the frozen line-item data, using the
// exact same roundCurrency policy every writer already uses
// (order-payable-calculation.ts / gst-calculation.ts) — never a second,
// independently-rounded formula that could drift from the writers'.
//
// Scope/limitation (explicitly acknowledged, never silently assumed away):
// the schema does NOT retain a per-line "subtotal/taxable value" column on
// OrderItem — only `taxRatePercent` and `taxAmount` survive as the frozen
// line-level snapshot (see OrderItem's schema doc comment). This means the
// EXACT frozen pre-tax taxable base for a line (buyerUnitPrice * quantity
// at confirmation time) can only be re-derived from taxAmount/taxRatePercent
// themselves (taxableValue = taxAmount / (taxRatePercent / 100)) when
// taxRatePercent is non-zero; a 0% line's taxable value cannot be
// independently re-derived this way (0 * anything = 0, so any taxable value
// would validate) — this is a genuine stored-data limitation, not a bug in
// this validator, and is called out explicitly below rather than silently
// skipped or assumed valid.
// ─────────────────────────────────────────────

export type OrderSnapshotLineFields = {
  lineItemId: string;
  taxRatePercent: number | null;
  taxAmount: number | null;
};

/** Default tolerance for floating-point/rounding drift when reconciling two
 * independently-rounded currency figures (e.g. a sum of per-line roundCurrency
 * outputs vs. an order-level roundCurrency output) — one cent, matching the
 * Decimal(12,2)/Decimal(5,2) column precision used throughout this schema. */
const CURRENCY_TOLERANCE = 0.01;

function isValidMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Validates line-item-level snapshot nullability: `taxRatePercent` and
 * `taxAmount` must be both null (unconfirmed/legacy line) or both non-null
 * (confirmed line) — mirrors assertConsistentOrderSnapshot's identical
 * pairing rule at the Order level, applied per OrderItem. Also rejects a
 * negative/non-finite taxRatePercent or taxAmount outright — a confirmed
 * line can never carry an invalid monetary/percentage value.
 */
export function assertConsistentOrderItemSnapshot(orderId: string, line: OrderSnapshotLineFields): void {
  const rateSet = line.taxRatePercent !== null;
  const amountSet = line.taxAmount !== null;
  if (rateSet !== amountSet) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `OrderItem ${line.lineItemId}: taxRatePercent (${line.taxRatePercent}) and taxAmount (${line.taxAmount}) must be both null or both set.`
    );
  }
  if (rateSet && (!isValidMoney(line.taxRatePercent) )) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `OrderItem ${line.lineItemId}: taxRatePercent (${line.taxRatePercent}) must be a non-negative, finite number.`
    );
  }
  if (amountSet && !isValidMoney(line.taxAmount)) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `OrderItem ${line.lineItemId}: taxAmount (${line.taxAmount}) must be a non-negative, finite number.`
    );
  }
}

export type OrderSnapshotArithmeticFields = {
  /** GST-exclusive subtotal this snapshot's taxAmount/finalPayableAmount
   * were derived from (Order.totalAmount at the exact confirmation moment —
   * callers must pass the value that was ACTUALLY frozen alongside this
   * snapshot, never a later/live totalAmount read, since totalAmount is not
   * itself immutable post-confirmation for every path — see this module's
   * callers for how each resolves this). */
  subtotal: number;
  taxAmount: number;
  finalPayableAmount: number;
  advancePercent: number | null;
  requiredAdvanceAmount: number | null;
};

/**
 * Validates the ARITHMETIC of a complete (non-null) Order-level snapshot —
 * strictly additive to assertConsistentOrderSnapshot's nullness checks.
 * Reuses the exact same roundCurrency as every writer (order-payable-
 * calculation.ts) for the reconciliation, with a one-cent tolerance for
 * legitimate rounding drift between a sum-of-already-rounded-lines figure
 * and an order-level rounded figure (see calculateOrderPayableTotals's own
 * doc comment on why summing already-rounded lines is the established
 * convention this schema follows).
 *
 * Checks:
 *   - taxAmount, finalPayableAmount, requiredAdvanceAmount are all
 *     non-negative, finite numbers (never NaN/Infinity/negative).
 *   - advancePercent (when set) is non-negative and finite.
 *   - finalPayableAmount ≈ subtotal + taxAmount.
 *   - requiredAdvanceAmount ≈ roundCurrency(finalPayableAmount * advancePercent / 100)
 *     (only checked when advancePercent is set — both are null together,
 *     already enforced by assertConsistentOrderSnapshot).
 *
 * Does NOT and cannot validate that `subtotal` itself is the TRUE original
 * marked-up taxable value — Order has no separate persisted "confirmed
 * subtotal" column distinct from the live totalAmount (see this type's
 * `subtotal` field doc comment); callers must supply the specific totalAmount
 * value that was actually frozen at confirmation time for this check to be
 * meaningful, and this function cannot detect a caller passing the wrong
 * value for `subtotal` itself.
 */
export function assertConsistentOrderSnapshotArithmetic(orderId: string, fields: OrderSnapshotArithmeticFields): void {
  if (!isValidMoney(fields.taxAmount)) {
    throw new InconsistentOrderSnapshotError(orderId, `taxAmount (${fields.taxAmount}) must be a non-negative, finite number.`);
  }
  if (!isValidMoney(fields.finalPayableAmount)) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `finalPayableAmount (${fields.finalPayableAmount}) must be a non-negative, finite number.`
    );
  }
  if (fields.advancePercent !== null && !isValidMoney(fields.advancePercent)) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `advancePercent (${fields.advancePercent}) must be a non-negative, finite number.`
    );
  }
  if (fields.requiredAdvanceAmount !== null && !isValidMoney(fields.requiredAdvanceAmount)) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `requiredAdvanceAmount (${fields.requiredAdvanceAmount}) must be a non-negative, finite number.`
    );
  }

  const expectedPayable = roundCurrency(fields.subtotal + fields.taxAmount);
  if (Math.abs(expectedPayable - roundCurrency(fields.finalPayableAmount)) > CURRENCY_TOLERANCE) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `finalPayableAmount (${fields.finalPayableAmount}) does not reconcile with subtotal (${fields.subtotal}) + taxAmount (${fields.taxAmount}) = ${expectedPayable}.`
    );
  }

  if (fields.advancePercent !== null && fields.requiredAdvanceAmount !== null) {
    const expectedAdvance = roundCurrency((fields.finalPayableAmount * fields.advancePercent) / 100);
    if (Math.abs(expectedAdvance - roundCurrency(fields.requiredAdvanceAmount)) > CURRENCY_TOLERANCE) {
      throw new InconsistentOrderSnapshotError(
        orderId,
        `requiredAdvanceAmount (${fields.requiredAdvanceAmount}) does not reconcile with finalPayableAmount (${fields.finalPayableAmount}) * advancePercent (${fields.advancePercent}) / 100 = ${expectedAdvance}.`
      );
    }
  }
}

/**
 * Validates that Order.taxAmount reconciles with the sum of every frozen,
 * non-null OrderItem.taxAmount for that order — the one cross-table
 * invariant assertConsistentOrderSnapshot cannot see (it only validates
 * Order's own columns). Callers pass every OrderItem row for the order;
 * this function sums only the lines that carry a non-null taxAmount (a
 * legacy/unconfirmed line contributes 0, matching how
 * calculateOrderPayableTotals never includes such a line in the first
 * place — a genuinely CONFIRMED order's every line is always non-null by
 * construction, so this is purely defensive).
 */
export function assertOrderTaxAmountReconcilesWithItems(
  orderId: string,
  orderTaxAmount: number,
  items: Array<{ taxAmount: number | null }>
): void {
  const summed = roundCurrency(
    items.reduce((sum, item) => sum + (item.taxAmount !== null ? Number(item.taxAmount) : 0), 0)
  );
  if (Math.abs(summed - roundCurrency(orderTaxAmount)) > CURRENCY_TOLERANCE) {
    throw new InconsistentOrderSnapshotError(
      orderId,
      `Order.taxAmount (${orderTaxAmount}) does not reconcile with the sum of OrderItem.taxAmount values (${summed}).`
    );
  }
}

export type FullOrderSnapshotFields = OrderSnapshotFields & {
  /**
   * The GST-exclusive subtotal this snapshot was frozen against —
   * Order.totalAmount AT THE MOMENT this snapshot's finalPayableAmount/
   * taxAmount were written. See every confirmation path's own doc comment
   * for why totalAmount is a safe proxy for this (none of the four
   * confirmation paths mutate totalAmount again after writing a non-null
   * finalPayableAmount — see each path's "Order-Total Synchronization"
   * notes and Phase 4.3's audit finding that the one totalAmount-resync
   * writer, declineOrderForSupplier, is only reachable from PLACED, which
   * is mutually exclusive with already having a non-null snapshot).
   */
  totalAmount: number;
};

/**
 * Phase 4.4 — the single, additive integration point composing EVERY
 * snapshot-integrity check this module exports (nullness-pairing,
 * order-level arithmetic, cross-table tax reconciliation, and per-line
 * nullability/validity) into one call, so a production call site that
 * already has the order + its items loaded can validate the COMPLETE
 * invariant set in one pass rather than remembering to call four separate
 * functions correctly. Callers that only have the Order row (no items)
 * should keep calling assertConsistentOrderSnapshot directly — this
 * function is for the sites that already fetched items for some other
 * reason (a post-write re-read right after writing the snapshot, or a
 * buyer-facing read that already selected items).
 *
 * Legacy orders (all four Order-level fields null): only the fast,
 * nullness-only assertConsistentOrderSnapshot check runs — never recomputes
 * historical GST/markup, never requires item-level data to be present for
 * these rows. A legacy order's items may themselves be fully null
 * (pre-feature) — that is expected and not an error.
 *
 * A CONFIRMED order (finalPayableAmount non-null): additionally requires
 * EVERY item to individually pass assertConsistentOrderItemSnapshot's
 * nullability/validity check, AND requires that no item be left with a
 * null taxAmount while the order itself is confirmed (a confirmed order
 * whose item snapshot is incomplete is exactly the "missing line snapshot
 * on a confirmed order" defect class this function exists to catch —
 * order-level completeness is never treated as sufficient on its own).
 */
export function assertFullOrderSnapshotIntegrity(
  orderId: string,
  order: FullOrderSnapshotFields,
  items: Array<{ id: string; taxRatePercent: number | null; taxAmount: number | null }>
): void {
  assertConsistentOrderSnapshot(orderId, order);

  const isConfirmed = order.finalPayableAmount !== null;
  if (!isConfirmed) {
    // Legacy/unconfirmed order — nothing further to check; never recompute
    // historical GST/markup, never require item-level data to be present.
    return;
  }

  for (const item of items) {
    assertConsistentOrderItemSnapshot(orderId, {
      lineItemId: item.id,
      taxRatePercent: item.taxRatePercent,
      taxAmount: item.taxAmount,
    });
    if (item.taxAmount === null) {
      // A confirmed order (order-level fields non-null) must never have an
      // item left with a null snapshot — order-level completeness is never
      // sufficient evidence that every line was actually frozen.
      throw new InconsistentOrderSnapshotError(
        orderId,
        `Order has a complete order-level snapshot but OrderItem ${item.id} has a null taxAmount — every line must be frozen together with the order.`
      );
    }
  }

  assertOrderTaxAmountReconcilesWithItems(orderId, order.taxAmount as number, items);

  assertConsistentOrderSnapshotArithmetic(orderId, {
    subtotal: order.totalAmount,
    taxAmount: order.taxAmount as number,
    finalPayableAmount: order.finalPayableAmount as number,
    advancePercent: order.advancePercent,
    requiredAdvanceAmount: order.requiredAdvanceAmount,
  });
}
