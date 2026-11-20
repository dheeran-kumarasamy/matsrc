// apps/api/src/admin/icici-payments/icici-gateway.util.ts
//
// ICICI Bank Payment Gateway — UAT ONLY. Minimal server-side gateway helper
// for the Admin-only REFUND action (task §27), self-contained within
// apps/api.
//
// NOTE: apps/web and apps/api are separate deployments/Vercel projects with
// independently-managed environment variables — this repo already has this
// exact pattern for the WhatsApp Meta credentials (see apps/web/.env.local's
// doc comment: "Mirrors the EXACT same values already configured in
// apps/api/.env... kept in sync manually whenever credentials rotate").
// ICICI_PG_* is duplicated here following that same established convention,
// rather than introducing new cross-app service-to-service coupling.
//
// Environment gate mirrors apps/web/lib/icici/environment.ts's
// isIciciUatAvailable() exactly — production is NEVER enabled here either,
// even if ICICI_PG_ENABLED="true" is present in apps/api's production env.
import { createHmac } from "crypto";

function detectEnvironment(env: NodeJS.ProcessEnv): string {
  // Guard: Vercel preview deployments are strictly staging/preview, NEVER uat or production
  if (env.VERCEL_ENV === "preview") {
    return "staging";
  }

  // Guard: Vercel production deployments are strictly production
  if (env.VERCEL_ENV === "production") {
    return "production";
  }

  // Explicit BUILDOHUB_ENV takes precedence for defining application runtime identity
  const buildohubEnv = (env.BUILDOHUB_ENV || "").toLowerCase();
  if (buildohubEnv === "uat") {
    // Conflicting configuration check: if DATABASE_ENV is explicitly set to something other than uat,
    // fail closed to development so UAT payment operations are denied.
    if (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() !== "uat") {
      return "development";
    }
    return "uat";
  }

  if (buildohubEnv === "production") return "production";
  if (buildohubEnv === "staging") return "staging";
  if (buildohubEnv === "test") return "test";
  if (buildohubEnv === "development") return "development";

  // Fallback to NODE_ENV
  const nodeEnv = (env.NODE_ENV || "").toLowerCase();
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";

  return "development";
}

export function isIciciUatAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  // 1. Database environment variables must NEVER independently authorise payment operations.
  const buildohubEnv = (env.BUILDOHUB_ENV || "").toLowerCase();
  if (buildohubEnv !== "uat") {
    return false;
  }

  // 2. Preview deployments must NOT enable ICICI operations
  if (env.VERCEL_ENV === "preview") {
    return false;
  }

  // 3. Production deployments must NOT enable ICICI operations
  if (env.VERCEL_ENV === "production") {
    return false;
  }

  // 4. Conflicting configuration check (e.g. DATABASE_ENV !== "uat")
  if (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() !== "uat") {
    return false;
  }

  // 5. Environment detection check
  if (detectEnvironment(env) !== "uat") {
    return false;
  }

  // 6. Explicit master switch
  return String(env.ICICI_PG_ENABLED || "").toLowerCase() === "true";
}

export type IciciUatConfig = {
  baseUrl: string;
  merchantId: string;
  aggregatorId: string;
  secretKey: string;
};

const DEFAULT_UAT_MERCHANT_ID = "100000000007164";
const DEFAULT_UAT_AGGREGATOR_ID = "A100000000007164";
const DEFAULT_UAT_SECRET_KEY = "db06cca0-838b-4e01-8b20-6ac446ffb6bd";

export function getIciciConfig(env: NodeJS.ProcessEnv = process.env): IciciUatConfig | null {
  if (!isIciciUatAvailable(env)) return null;
  const merchantId = env.ICICI_PG_MERCHANT_ID || DEFAULT_UAT_MERCHANT_ID;
  const aggregatorId = env.ICICI_PG_AGGREGATOR_ID || DEFAULT_UAT_AGGREGATOR_ID;
  const secretKey = env.ICICI_PG_SECRET_KEY || DEFAULT_UAT_SECRET_KEY;
  if (!merchantId || !aggregatorId || !secretKey) return null;
  const baseUrl = env.ICICI_PG_BASE_URL || "https://pgpayuat.icicibank.com";
  if (!baseUrl.includes("pgpayuat.icicibank.com")) return null;
  return { baseUrl, merchantId, aggregatorId, secretKey };
}

function buildSignableString(payload: Record<string, any>): string {
  const keys = Object.keys(payload)
    .filter((k) => k !== "secureHash")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keys.map((k) => (payload[k] === null || payload[k] === undefined ? "" : String(payload[k]))).join("");
}

export function generateICICIHash(payload: Record<string, any>, secret: string): string {
  return createHmac("sha256", secret).update(buildSignableString(payload), "utf8").digest("hex");
}

export async function requestRefund(
  config: IciciUatConfig,
  params: { merchantTxnNo: string; refundAmount: string; gatewayTxnId: string }
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const payload: Record<string, any> = {
    merchantId: config.merchantId,
    merchantTxnNo: params.merchantTxnNo,
    aggregatorID: config.aggregatorId,
    transactionType: "REFUND",
    refundAmount: params.refundAmount,
    bankTxnId: params.gatewayTxnId,
  };
  const secureHash = generateICICIHash(payload, config.secretKey);

  try {
    const response = await fetch(`${config.baseUrl}/tsp/pg/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secureHash }),
    });
    const data = await response.json().catch(() => null);
    if (!data) return { ok: false, error: "Malformed/non-JSON response from ICICI REFUND command" };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown network error calling ICICI REFUND command" };
  }
}

// Exported for tests only
export { detectEnvironment as __detectEnvironmentForTests };
