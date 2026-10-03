// apps/web/lib/icici/config.ts
//
// ICICI Bank Payment Gateway — UAT ONLY. Server-only configuration reader.
//
// getIciciConfig() returns null whenever isIciciUatAvailable() is false —
// every caller MUST treat a null config as "ICICI is unavailable" and never
// attempt to fall back to any default/hard-coded gateway URL or credential.
// This means a misconfigured or production environment can NEVER accidentally
// obtain a usable ICICI config, even if individual ICICI_PG_* variables are
// present (e.g. copy-pasted from a UAT .env into production by mistake).
import "server-only";
import { isIciciUatAvailable } from "./environment";

export type IciciUatConfig = {
  environment: "uat";
  baseUrl: string;
  merchantId: string;
  aggregatorId: string;
  secretKey: string;
  returnUrl: string;
};

const DEFAULT_UAT_BASE_URL = "https://pgpayuat.icicibank.com";

// Never use this for a live callback unless ICICI has confirmed the UAT
// callback URL is registered for the UAT merchant configuration — see
// docs/payments/icici-uat.md §Callback Configuration Dependency.
const DEFAULT_UAT_RETURN_URL = "https://uat.buildohub.in/api/payment/callback";

export function getIciciConfig(env: NodeJS.ProcessEnv = process.env): IciciUatConfig | null {
  if (!isIciciUatAvailable(env)) return null;

  const merchantId = env.ICICI_PG_MERCHANT_ID;
  const aggregatorId = env.ICICI_PG_AGGREGATOR_ID;
  const secretKey = env.ICICI_PG_SECRET_KEY;

  // Fail closed: without real UAT merchant credentials there is nothing safe
  // to initiate against ICICI, even though the environment gate passed.
  if (!merchantId || !aggregatorId || !secretKey) {
    return null;
  }

  const baseUrl = env.ICICI_PG_BASE_URL || DEFAULT_UAT_BASE_URL;
  const returnUrl = env.ICICI_PG_RETURN_URL || DEFAULT_UAT_RETURN_URL;

  // Defence in depth: even if every other guard were somehow bypassed, never
  // allow a non-UAT ICICI base URL or a non-UAT (e.g. production) callback
  // URL to be used by this UAT-only implementation.
  if (!baseUrl.includes("pgpayuat.icicibank.com")) {
    return null;
  }
  if (!returnUrl.includes("uat.buildohub.in")) {
    return null;
  }

  return {
    environment: "uat",
    baseUrl,
    merchantId,
    aggregatorId,
    secretKey,
    returnUrl,
  };
}
