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
  const candidates = [env.DATABASE_ENV, env.BUILDOHUB_ENV, env.VERCEL_ENV, env.NODE_ENV];
  for (const raw of candidates) {
    if (!raw) continue;
    const value = String(raw).toLowerCase();
    if (value === "production") return "production";
    if (value === "uat") return "uat";
    if (value === "preview" || value === "staging") return "staging";
    if (value === "test") return "test";
    if (value === "development") return "development";
  }
  return "development";
}

export function isIciciUatAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return detectEnvironment(env) === "uat" && String(env.ICICI_PG_ENABLED || "").toLowerCase() === "true";
}

export type IciciUatConfig = {
  baseUrl: string;
  merchantId: string;
  aggregatorId: string;
  secretKey: string;
};

export function getIciciConfig(env: NodeJS.ProcessEnv = process.env): IciciUatConfig | null {
  if (!isIciciUatAvailable(env)) return null;
  const merchantId = env.ICICI_PG_MERCHANT_ID;
  const aggregatorId = env.ICICI_PG_AGGREGATOR_ID;
  const secretKey = env.ICICI_PG_SECRET_KEY;
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
