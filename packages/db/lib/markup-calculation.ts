// packages/db/lib/markup-calculation.ts
//
// Admin-Configurable Product Markup — shared, framework-agnostic markup
// resolution + calculation used by both apps/api (NestJS) and apps/web /
// apps/supplier (Next.js, direct Prisma access), so there is exactly ONE
// place this math is implemented. Mirrors the existing convention already
// established by gst-calculation.ts / supplier-invoice-reconciliation.ts.
//
// Confirmed business model:
//   1. The supplier enters their ORIGINAL price in the supplier portal.
//   2. Buildohub applies an admin-configured PERCENTAGE MARKUP to that
//      original price.
//   3. The buyer sees/pays the MARKED-UP price to Buildohub.
//   4. Buildohub pays the supplier the ORIGINAL price (subject to
//      settlement terms — settlement execution is a separate, currently
//      non-existent feature; see this module's own scope note below).
//
// Fixed formula — markup is ALWAYS a percentage of the ORIGINAL supplier
// price, NEVER a percentage of the already-marked-up buyer price:
//   buyerUnitPrice = supplierUnitPrice * (1 + markupPercent / 100)
//   markupAmount   = buyerUnitPrice - supplierUnitPrice
//
// Rounding happens only at the END of each computation (never on
// intermediate values) — mirrors calculateLineGst()'s identical convention.
//
// Validation policy (explicit product decision): NO maximum markup
// percentage is enforced by this module. Only negative, NaN, non-finite, or
// otherwise malformed percentages/prices are rejected. A business-approved
// maximum, if one is ever adopted, must be layered on by the caller rather
// than invented here.
//
// Out of scope: this module computes BUYER-facing pricing and the gross
// markup amount only. It never computes, authorizes, or executes a payment
// TO the supplier — Buildohub currently has no supplier payout/settlement
// module; `supplierUnitPrice` is preserved purely as the data a future,
// separately-approved settlement feature would need.

import { roundCurrency } from "./gst-calculation";

/** A configured markup rule at one precedence tier. */
export type MarkupSettingInput = {
  percentage: number;
  isEnabled: boolean;
};

/**
 * Resolves the effective markup percentage from product/category/global
 * settings, using the documented precedence: PRODUCT override -> CATEGORY
 * override -> GLOBAL default. A tier is only used if it exists AND
 * `isEnabled` is true — a disabled or missing tier falls through to the
 * next one, exactly like an unset override. An explicit 0% enabled
 * override is honoured as-is (never treated as "unset").
 *
 * Returns null (never 0, never a guessed default) when no enabled setting
 * exists at ANY tier — callers must treat null as "markup configuration is
 * missing" and decide their own safe fallback, rather than this module
 * silently assuming one.
 */
export function resolveEffectiveMarkupPercent(tiers: {
  product?: MarkupSettingInput | null;
  category?: MarkupSettingInput | null;
  global?: MarkupSettingInput | null;
}): number | null {
  for (const tier of [tiers.product, tiers.category, tiers.global]) {
    if (tier && tier.isEnabled && isValidMarkupPercent(tier.percentage)) {
      return tier.percentage;
    }
  }
  return null;
}

/**
 * Strict validation for an admin-configured markup percentage: rejects
 * negative values, NaN, Infinity, and non-finite input. No upper ceiling is
 * enforced — see this module's top doc comment for why. Zero is valid (an
 * explicit 0% override is a legitimate, intentional configuration).
 */
export function isValidMarkupPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Strict validation for an original supplier unit price used as the markup
 * base: rejects negative, NaN, Infinity, and non-finite values. Mirrors
 * gst-calculation.ts's isValidQuotedPrice exactly — kept as a separate,
 * explicitly named export here so a caller validating a markup BASE price
 * reads as such, rather than reusing an RFQ-specific name.
 */
export function isValidSupplierPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export type MarkupCalculationInput = {
  /** The ORIGINAL supplier unit price — the markup base. Never the buyer price. */
  supplierUnitPrice: number;
  /** The applicable, already-resolved markup percentage (see resolveEffectiveMarkupPercent). */
  markupPercent: number;
};

export type MarkupCalculationResult = {
  supplierUnitPrice: number;
  markupPercent: number;
  /** buyerUnitPrice = supplierUnitPrice * (1 + markupPercent / 100), rounded to 2dp. */
  buyerUnitPrice: number;
  /** markupAmount = buyerUnitPrice - supplierUnitPrice, rounded to 2dp. */
  markupAmount: number;
};

/**
 * Computes the buyer-facing marked-up price from an ORIGINAL supplier price
 * and a resolved markup percentage. Throws (never silently returns 0/NaN)
 * if either input fails validation — "fail safely" means refusing to
 * produce a bogus price, not guessing one.
 *
 * Double-markup prevention: this function always takes `supplierUnitPrice`
 * as its base — it is the caller's responsibility (see every call site in
 * this codebase) to pass the ORIGINAL supplier price here, never a
 * previously-computed buyerUnitPrice. The single authoritative rule is:
 * only ever call this with Product.basePrice / SupplierQuote.unitPrice (the
 * supplier's own entered figure) as input — never with OrderItem.unitPrice
 * or any other already-marked-up value.
 */
export function calculateMarkup(input: MarkupCalculationInput): MarkupCalculationResult {
  if (!isValidSupplierPrice(input.supplierUnitPrice)) {
    throw new Error(`Invalid supplier unit price for markup calculation: ${input.supplierUnitPrice}`);
  }
  if (!isValidMarkupPercent(input.markupPercent)) {
    throw new Error(`Invalid markup percentage for markup calculation: ${input.markupPercent}`);
  }

  const supplierUnitPrice = roundCurrency(input.supplierUnitPrice);
  const buyerUnitPriceRaw = input.supplierUnitPrice * (1 + input.markupPercent / 100);
  const buyerUnitPrice = roundCurrency(buyerUnitPriceRaw);
  const markupAmount = roundCurrency(buyerUnitPrice - supplierUnitPrice);

  return {
    supplierUnitPrice,
    markupPercent: input.markupPercent,
    buyerUnitPrice,
    markupAmount,
  };
}

/**
 * Convenience wrapper: resolves the effective percentage AND computes the
 * markup in one call. Returns null if no enabled markup setting exists at
 * any tier — the caller decides the safe fallback (this module never
 * assumes 0% on missing configuration — a genuinely intentional "no markup
 * configured yet" state must be visibly different from an explicit,
 * admin-configured 0%).
 */
export function resolveAndCalculateMarkup(
  supplierUnitPrice: number,
  tiers: {
    product?: MarkupSettingInput | null;
    category?: MarkupSettingInput | null;
    global?: MarkupSettingInput | null;
  }
): MarkupCalculationResult | null {
  const markupPercent = resolveEffectiveMarkupPercent(tiers);
  if (markupPercent === null) {
    return null;
  }
  return calculateMarkup({ supplierUnitPrice, markupPercent });
}

// ─────────────────────────────────────────────
// Database-backed resolution — the single shared read path both apps/api
// (via PrismaService) and apps/web/apps/supplier (via the shared `prisma`
// export) use to fetch the applicable MarkupSetting rows for a given
// product/category. Takes a minimal structural Prisma client type (mirrors
// the existing AdvanceLedgerTxClient / TxClient convention elsewhere in
// this package) so it works identically inside or outside a transaction.
export type MarkupSettingTxClient = {
  markupSetting: {
    findMany: (args: any) => Promise<Array<{ scope: string; scopeId: string | null; percentage: unknown; isEnabled: boolean }>>;
  };
};

/**
 * Fetches the applicable PRODUCT/CATEGORY/GLOBAL MarkupSetting rows for a
 * given product+category in a single query, and resolves + calculates the
 * buyer-facing price from `supplierUnitPrice` in one call. Returns null —
 * same contract as resolveAndCalculateMarkup — when no enabled setting
 * exists at any tier.
 */
export async function resolveMarkupForProduct(
  tx: MarkupSettingTxClient,
  params: { productId: string; categoryId: string; supplierUnitPrice: number }
): Promise<MarkupCalculationResult | null> {
  const rows = await tx.markupSetting.findMany({
    where: {
      OR: [
        { scope: "PRODUCT", scopeId: params.productId },
        { scope: "CATEGORY", scopeId: params.categoryId },
        { scope: "GLOBAL", scopeId: null },
      ],
    },
  });

  const toTier = (scope: string, scopeId: string | null): MarkupSettingInput | null => {
    const row = rows.find((r) => r.scope === scope && r.scopeId === scopeId);
    return row ? { percentage: Number(row.percentage), isEnabled: row.isEnabled } : null;
  };

  return resolveAndCalculateMarkup(params.supplierUnitPrice, {
    product: toTier("PRODUCT", params.productId),
    category: toTier("CATEGORY", params.categoryId),
    global: toTier("GLOBAL", null),
  });
}
