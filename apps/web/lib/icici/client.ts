// apps/web/lib/icici/client.ts
//
// ICICI Bank Payment Gateway — UAT ONLY. Server-to-server HTTPS client for
// ICICI's UAT endpoints:
//   - Initiate Sale:        https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale
//   - Status/Command API:   https://pgpayuat.icicibank.com/tsp/pg/api/command
//   - Settlement Details:   https://pgpayuat.icicibank.com/tsp/pg/api/settlementDetails (not used — out of scope per task)
//
// NEVER called from the browser — every function here is imported only by
// Next.js Route Handlers (app/api/**) running server-side. The browser never
// sees ICICI_PG_SECRET_KEY or any other credential.
//
// Infrastructure note: Buildohub runs on Vercel Serverless with dynamic
// outbound IPs (see docs/payments/icici-uat.md §Vercel Dynamic IP). This
// client makes a plain server-to-server HTTPS fetch() call — it does NOT
// assume or hard-code any static egress IP. If ICICI's UAT environment
// enforces IP allowlisting, that is an ICICI-side / infrastructure
// dependency to resolve separately (e.g. a future NAT/static-egress
// architecture) — this code does not and must not pretend to solve it.
import "server-only";
import { getIciciConfig, type IciciUatConfig } from "./config";
import { generateICICIHash, verifyICICIHash, type IciciHashablePayload } from "./hash";
import { formatIciciTxnDate, formatIciciTxnDateCompact } from "./txn-date";

// --- UNCONFIRMED PROTOCOL DETAILS (see docs/payments/icici-uat.md §9 and
// hash.ts's spec-assumption caveat) ---------------------------------------
// This repo was never supplied ICICI's actual signed PG v2 API spec
// document. The two fields below now default to the common ICICI PG v2
// (PayPhi-based) convention rather than this repo's original empirically-
// tested-but-likely-wrong defaults:
//   - currencyCode: ISO 4217 **numeric** code "356" (not the alphabetic
//     "INR") — the standard PayPhi/PG v2 convention.
//   - txnDate: a 14-digit "yyyyMMddHHmmss" compact string (not the spaced
//     "yyyy-MM-dd HH:mm:ss" format this repo's txn-date.ts also still
//     provides) — the standard PG v2 convention.
// Both remain configurable via env var (now to opt BACK INTO the old
// alphabetic/spaced convention, in case "356"/compact is ever rejected by
// ICICI UAT) so either convention can be tried against the live sandbox
// without a further code change, while the real spec remains unconfirmed.
// Once ICICI's spec is confirmed, remove this toggle and hard-code the
// correct value.
function resolveCurrencyCode(): string {
  // Set ICICI_PG_CURRENCY_CODE="INR" to fall back to the alphabetic code.
  return process.env.ICICI_PG_CURRENCY_CODE || "356";
}

function resolveTxnDate(date: Date): string {
  // Set ICICI_PG_TXN_DATE_FORMAT="spaced" to fall back to the
  // "yyyy-MM-dd HH:mm:ss" convention instead of the compact default.
  return (process.env.ICICI_PG_TXN_DATE_FORMAT || "").toLowerCase() === "spaced"
    ? formatIciciTxnDate(date)
    : formatIciciTxnDateCompact(date);
}

export type IciciInitiateSaleParams = {
  merchantTxnNo: string;
  amount: string; // ICICI expects amount as a formatted string (e.g. "1000.00")
  customerEmailId: string;
  customerMobileNo: string;
};

export type IciciGatewayCallResult<T> =
  | { ok: true; httpStatus: number; data: T; rawRequest: IciciHashablePayload }
  | { ok: false; httpStatus: number | null; error: string; rawRequest: IciciHashablePayload };

const REQUEST_TIMEOUT_MS = 15000;

async function postJson(url: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: any = null;
    try {
      json = await response.json();
    } catch {
      // Malformed/non-JSON response — handled by callers as a gateway error.
      json = null;
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls ICICI UAT's Initiate Sale API. Uses the documented field names from
 * task section 19 — never sends undocumented fields.
 */
export async function initiateSale(
  config: IciciUatConfig,
  params: IciciInitiateSaleParams
): Promise<IciciGatewayCallResult<any>> {
  // See ./txn-date.ts for why this specific format/timezone is required —
  // confirmed against a real rejection from the live ICICI UAT sandbox
  // (responseCode P1006 "Invalid Transaction Date"). See the module-level
  // comment above resolveCurrencyCode()/resolveTxnDate() — both the
  // currency code and txnDate format remain unconfirmed against ICICI's
  // real spec and are configurable via env vars for testing.
  const txnDate = resolveTxnDate(new Date());
  const currencyCode = resolveCurrencyCode();

  const payload: IciciHashablePayload = {
    merchantId: config.merchantId,
    merchantTxnNo: params.merchantTxnNo,
    amount: params.amount,
    aggregatorID: config.aggregatorId,
    currencyCode,
    payType: "0", // ICICI UAT sample value for a standard sale transaction
    customerEmailID: params.customerEmailId,
    transactionType: "SALE",
    txnDate,
    returnURL: config.returnUrl,
    customerMobileNo: params.customerMobileNo,
  };

  const secureHash = generateICICIHash(payload, config.secretKey);
  const requestBody = { ...payload, secureHash };

  // DIAGNOSTIC LOGGING (task: verify currencyCode/txnDate convention): log
  // which variant of each unconfirmed field was actually sent, so a UAT
  // rejection's responseCode/responseDescription (logged by the caller,
  // apps/web/app/api/builder/orders/[id]/payment/icici/initiate/route.ts)
  // can be correlated back to exactly what was sent.
  console.log("[ICICI initiateSale] request variant", {
    merchantTxnNo: params.merchantTxnNo,
    currencyCode,
    txnDate,
    txnDateFormat: (process.env.ICICI_PG_TXN_DATE_FORMAT || "compact (default)").toLowerCase(),
  });

  try {
    const { status, json } = await postJson(`${config.baseUrl}/tsp/pg/api/v2/initiateSale`, requestBody);
    if (!json) {
      return { ok: false, httpStatus: status, error: "Malformed/non-JSON response from ICICI initiateSale", rawRequest: payload };
    }
    return { ok: true, httpStatus: status, data: json, rawRequest: payload };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      error: error instanceof Error ? error.message : "Unknown network error calling ICICI initiateSale",
      rawRequest: payload,
    };
  }
}

/**
 * Calls ICICI UAT's Status/Command API with transactionType=STATUS. The
 * browser must NEVER call this directly — only the server, after a
 * callback/return, to independently confirm the transaction's real outcome.
 */
export async function queryStatus(
  config: IciciUatConfig,
  merchantTxnNo: string
): Promise<IciciGatewayCallResult<any>> {
  const payload: IciciHashablePayload = {
    merchantId: config.merchantId,
    merchantTxnNo,
    aggregatorID: config.aggregatorId,
    transactionType: "STATUS",
  };

  const secureHash = generateICICIHash(payload, config.secretKey);
  const requestBody = { ...payload, secureHash };

  try {
    const { status, json } = await postJson(`${config.baseUrl}/tsp/pg/api/command`, requestBody);
    if (!json) {
      return { ok: false, httpStatus: status, error: "Malformed/non-JSON response from ICICI STATUS command", rawRequest: payload };
    }
    return { ok: true, httpStatus: status, data: json, rawRequest: payload };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      error: error instanceof Error ? error.message : "Unknown network error calling ICICI STATUS command",
      rawRequest: payload,
    };
  }
}

/**
 * Calls ICICI UAT's Status/Command API with transactionType=REFUND.
 * Admin-authorized, server-side only — see app/api routes under
 * admin/payments/icici for the authorization gate.
 */
export async function requestRefund(
  config: IciciUatConfig,
  params: { merchantTxnNo: string; refundAmount: string; gatewayTxnId: string }
): Promise<IciciGatewayCallResult<any>> {
  const payload: IciciHashablePayload = {
    merchantId: config.merchantId,
    merchantTxnNo: params.merchantTxnNo,
    aggregatorID: config.aggregatorId,
    transactionType: "REFUND",
    refundAmount: params.refundAmount,
    bankTxnId: params.gatewayTxnId,
  };

  const secureHash = generateICICIHash(payload, config.secretKey);
  const requestBody = { ...payload, secureHash };

  try {
    const { status, json } = await postJson(`${config.baseUrl}/tsp/pg/api/command`, requestBody);
    if (!json) {
      return { ok: false, httpStatus: status, error: "Malformed/non-JSON response from ICICI REFUND command", rawRequest: payload };
    }
    return { ok: true, httpStatus: status, data: json, rawRequest: payload };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      error: error instanceof Error ? error.message : "Unknown network error calling ICICI REFUND command",
      rawRequest: payload,
    };
  }
}

export { verifyICICIHash, getIciciConfig };
