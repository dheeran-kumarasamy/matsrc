// packages/db/lib/gst-rate-resolution.ts
//
// Product-Level GST — shared, framework-agnostic GST (tax) rate resolution
// used by both apps/api (NestJS) and apps/web / apps/supplier (Next.js,
// direct Prisma access), mirroring the existing convention already
// established by markup-calculation.ts (PRODUCT -> CATEGORY -> GLOBAL
// precedence, same enable/disable-without-forgetting semantics).
//
// UNLIKE resolveEffectiveMarkupPercent (which returns null and lets callers
// silently treat "no markup configured" as "0% markup"), this resolver's
// contract is deliberately stricter: a missing/invalid GST rate is NEVER a
// safe 0%, 18%, or any other invented default — see TaxSetting's schema doc
// comment. Callers (the confirmation-path writer — Phase 2) MUST treat an
// unresolved result as "block order confirmation", not as "GST is zero".
//
// This module is pure: it only resolves from TaxSetting ROW DATA passed in
// by the caller. It never queries the database itself (mirrors
// resolveEffectiveMarkupPercent's pure core, with resolveMarkupForProduct as
// the separate, thin DB-reading wrapper around it — see
// resolveGstRateForProduct below for this module's equivalent wrapper).

/** A configured GST rule at one precedence tier. */
export type TaxSettingInput = {
  percentage: number;
  isEnabled: boolean;
};

export type GstRateScope = "PRODUCT" | "CATEGORY" | "GLOBAL";

/** Successfully resolved an enabled, valid GST rate from some tier. */
export type GstRateResolved = {
  resolved: true;
  percentage: number;
  scope: GstRateScope;
};

/**
 * No enabled, valid GST rate exists at any tier. `reason` distinguishes
 * "nothing configured anywhere" from "something was configured but is
 * invalid/disabled", for caller-side diagnostics/logging — both cases MUST
 * be treated identically by the caller (block confirmation), never
 * differently defaulted.
 */
export type GstRateUnresolved = {
  resolved: false;
  reason: "NO_SETTING_CONFIGURED" | "ALL_CONFIGURED_SETTINGS_DISABLED_OR_INVALID";
};

export type GstRateResolution = GstRateResolved | GstRateUnresolved;

/**
 * Strict validation for an admin-configured GST percentage: rejects
 * negative values, NaN, Infinity, and non-finite input. No statutory
 * maximum is enforced or inferred here — this module never decides tax
 * classification from a rate alone (mirrors isValidMarkupPercent's
 * identical validation policy and its reasoning: a business-approved
 * ceiling, if ever adopted, must be layered on by the caller). Zero is
 * valid (an explicit 0% override — e.g. a GST-exempt product category — is
 * a legitimate, intentional configuration, never treated as "unset").
 */
export function isValidTaxPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Resolves the effective GST percentage from product/category/global
 * settings, using the documented precedence: PRODUCT override -> CATEGORY
 * override -> GLOBAL default. A tier is only used if it exists AND
 * `isEnabled` is true AND its percentage passes `isValidTaxPercent` — a
 * disabled, missing, or invalid tier falls through to the next one. An
 * explicit 0% enabled override is honoured as-is.
 *
 * Returns a GstRateUnresolved result (NEVER a guessed default, NEVER 0 by
 * silent fallback) when no enabled, valid setting exists at ANY tier —
 * callers MUST treat this as "GST configuration is missing for this
 * product" and refuse to proceed with order confirmation, exactly per
 * TaxSetting's schema doc comment.
 */
export function resolveGstRate(tiers: {
  product?: TaxSettingInput | null;
  category?: TaxSettingInput | null;
  global?: TaxSettingInput | null;
}): GstRateResolution {
  const ordered: Array<{ scope: GstRateScope; tier: TaxSettingInput | null | undefined }> = [
    { scope: "PRODUCT", tier: tiers.product },
    { scope: "CATEGORY", tier: tiers.category },
    { scope: "GLOBAL", tier: tiers.global },
  ];

  let sawAnyConfiguredTier = false;

  for (const { scope, tier } of ordered) {
    if (!tier) continue;
    sawAnyConfiguredTier = true;
    if (tier.isEnabled && isValidTaxPercent(tier.percentage)) {
      return { resolved: true, percentage: tier.percentage, scope };
    }
  }

  return {
    resolved: false,
    reason: sawAnyConfiguredTier ? "ALL_CONFIGURED_SETTINGS_DISABLED_OR_INVALID" : "NO_SETTING_CONFIGURED",
  };
}

// ─────────────────────────────────────────────
// Database-backed resolution — the single shared read path both apps/api
// (via PrismaService) and apps/web/apps/supplier (via the shared `prisma`
// export) use to fetch the applicable TaxSetting rows for a given
// product/category. Takes a minimal structural Prisma client type (mirrors
// MarkupSettingTxClient exactly) so it works identically inside or outside
// a transaction.
export type TaxSettingTxClient = {
  taxSetting: {
    findMany: (args: any) => Promise<Array<{ scope: string; scopeId: string | null; percentage: unknown; isEnabled: boolean }>>;
  };
};

/**
 * Fetches the applicable PRODUCT/CATEGORY/GLOBAL TaxSetting rows for a
 * given product+category in a single query, and resolves the effective GST
 * rate in one call. Same strict contract as resolveGstRate: returns a
 * GstRateUnresolved result (never a guessed default) when no enabled, valid
 * setting exists at any tier.
 */
export async function resolveGstRateForProduct(
  tx: TaxSettingTxClient,
  params: { productId: string; categoryId: string }
): Promise<GstRateResolution> {
  const rows = await tx.taxSetting.findMany({
    where: {
      OR: [
        { scope: "PRODUCT", scopeId: params.productId },
        { scope: "CATEGORY", scopeId: params.categoryId },
        { scope: "GLOBAL", scopeId: null },
      ],
    },
  });

  const toTier = (scope: string, scopeId: string | null): TaxSettingInput | null => {
    const row = rows.find((r) => r.scope === scope && r.scopeId === scopeId);
    return row ? { percentage: Number(row.percentage), isEnabled: row.isEnabled } : null;
  };

  return resolveGstRate({
    product: toTier("PRODUCT", params.productId),
    category: toTier("CATEGORY", params.categoryId),
    global: toTier("GLOBAL", null),
  });
}
