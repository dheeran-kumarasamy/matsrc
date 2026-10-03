# ICICI Bank Payment Gateway — UAT ONLY

**This integration is strictly scoped to Buildohub's UAT environment
(`https://uat.buildohub.in`). Production ICICI payment functionality is
DISABLED and must remain disabled until a separate, explicit instruction
from the project owner authorizes production activation.**

A git commit, git push, pull request, merge, deployment, Vercel deployment,
production build, or successful UAT test does **NOT** constitute that
authorization.

---

## 1. Production safety model

The single source of truth for "is ICICI available right now" is
[`apps/web/lib/icici/environment.ts`](../../apps/web/lib/icici/environment.ts)'s
`isIciciUatAvailable()`. It requires **both**:

1. The resolved Buildohub environment is explicitly `"uat"` — detected via
   (in precedence order) `DATABASE_ENV` → `BUILDOHUB_ENV` → `VERCEL_ENV` →
   `NODE_ENV`, mirroring the existing, reviewed convention in
   `packages/db/lib/db-safety.js`'s `detectEnvironment()`.
2. `ICICI_PG_ENABLED="true"` is explicitly set.

An unset/unknown environment resolves to `"development"`, never to `"uat"`
or `"production"` — so an ambiguous environment always fails closed to
"ICICI unavailable". Critically: **copying `ICICI_PG_ENABLED="true"` and UAT
credentials into the production deployment's environment variables does
NOT enable ICICI there**, because condition (1) independently fails unless
`BUILDOHUB_ENV`/`VERCEL_ENV`/`NODE_ENV` also resolve to `"uat"` on that
specific deployment.

Every initiation / callback / status-verification / refund code path calls
this guard (directly, or via `getIciciConfig()`, which wraps it) before
doing anything. `apps/api`'s refund action duplicates this exact same guard
in `apps/api/src/admin/icici-payments/icici-gateway.util.ts` since apps/web
and apps/api are separate deployments with independently-managed
environment variables (the same pattern already used for the WhatsApp Meta
credentials in this repo).

The ICICI payment UI panel on the builder payment page is also gated
server-side by this exact same check (`app/(builder)/orders/[id]/payment/page.tsx`)
— it is never rendered into the HTML at all on a non-UAT deployment, not
merely hidden by client-side CSS/JS.

## 2. Required environment variables

See `.env.example` (repo root) for the full, documented list:

```
BUILDOHUB_ENV=""              # Set to "uat" ONLY on the UAT deployment
ICICI_PG_ENV="uat"
ICICI_PG_ENABLED="false"      # Set to "true" ONLY on the UAT deployment
ICICI_PG_BASE_URL="https://pgpayuat.icicibank.com"
ICICI_PG_MERCHANT_ID=""
ICICI_PG_AGGREGATOR_ID=""
ICICI_PG_SECRET_KEY=""
ICICI_PG_RETURN_URL="https://uat.buildohub.in/api/payment/callback"
```

Real credentials are supplied only via the secure UAT deployment's
environment variables (e.g. Vercel's UAT environment) — never committed.

## 3. ICICI UAT endpoints used

- Initiate Sale: `https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale`
- Status/Command API (`STATUS` / `REFUND`): `https://pgpayuat.icicibank.com/tsp/pg/api/command`
- Settlement Details: not implemented — out of scope for this phase.

## 4. Callback URL — ICICI-side configuration dependency

The UAT callback is `https://uat.buildohub.in/api/payment/callback`. The
callback URL previously supplied to ICICI during onboarding was the
production URL `https://buildohub.in/api/payment/callback`.

**Before testing, confirm with the ICICI team that the UAT callback URL
above is registered/whitelisted for the UAT merchant configuration.** If
ICICI has only configured the production callback, the UAT gateway will
simply never be able to reach this UAT deployment — that is an ICICI-side
configuration dependency, not something this code works around. The return
URL is configurable via `ICICI_PG_RETURN_URL`; `getIciciConfig()` additionally
refuses to use any return URL that does not contain `uat.buildohub.in`, as a
defence-in-depth guard against ever pointing a UAT transaction at the
production callback.

## 5. Payment flow

1. Builder opens `/orders/[id]/payment`. If `isIciciUatAvailable()` is true
   server-side, the "ICICI Online Payment — UAT" panel is rendered alongside
   the existing bank-transfer panel (additive, never replacing it).
2. Builder clicks "Pay Now" → `POST /api/builder/orders/[id]/payment/icici/initiate`.
   - Authenticates the builder, verifies order ownership.
   - Reads `Order.totalAmount` from the database — never trusts a
     browser-supplied amount.
   - Reuses an in-flight (`INITIATED`/`REDIRECTED`/`PENDING`) transaction if
     one already exists for this order (idempotency against double-click).
   - Generates a unique `merchantTxnNo` (≤20 alphanumeric chars,
     `lib/icici/merchant-txn.ts`) and `paymentReference`.
   - Creates a `PaymentTransaction` row, calls ICICI's Initiate Sale API
     (HMAC-signed via `lib/icici/hash.ts`), stores the request/response, and
     returns only the redirect URL to the browser.
3. Builder completes payment on ICICI's UAT page.
4. ICICI calls back `POST /api/payment/callback` (public, unauthenticated —
   ICICI cannot carry a Buildohub session). The route:
   - Looks up the transaction by `merchantTxnNo`.
   - Independently recomputes and verifies the HMAC on the callback payload.
   - Validates the callback-claimed amount against the amount recorded at
     initiation.
   - Performs a server-side `STATUS` command call (never trusting the
     callback alone) and verifies that response's HMAC too.
   - Only on a verified `SUCCESS` status does it mark
     `PaymentTransaction.status = SUCCESS` and `Order.paymentStatus = PAID`
     (within a DB transaction, idempotent against duplicate callbacks).
   - Redirects the builder to `/orders/[id]/payment/result`.
5. The result page reads `GET /api/builder/orders/[id]/payment/icici/status`
   — always the verified backend state, never the raw redirect query string.

## 6. Payment states

`PaymentTransactionStatus`: `INITIATED`, `REDIRECTED`, `PENDING`, `SUCCESS`,
`FAILED`, `CANCELLED`, `REFUND_INITIATED`, `REFUNDED`, `REFUND_FAILED`. A
gateway timeout/unreachable condition is always recorded as `PENDING`, never
`FAILED` — see `lib/icici/client.ts` and the callback route.

## 7. Refund

Admin-only, server-side-only (`PATCH /admin/icici-payments/:id/refund` in
`apps/api`), gated by the same UAT-only environment check. Validates the
transaction is `SUCCESS`, rejects a refund above the paid amount, and
prevents a duplicate refund on an already-`REFUNDED`/`REFUND_INITIATED` row.
Writes an `AuditLog` entry. Never exposes gateway credentials.

## 8. Admin visibility

`GET /admin/icici-payments` and `GET /admin/icici-payments/:id`
(`apps/api/src/admin/icici-payments/`) expose: order id, payment reference,
merchant transaction number, gateway, environment, amount, status, gateway
transaction id, payment mode, timestamps. **Never** `ICICI_PG_SECRET_KEY`,
HMAC secrets, or merchant credentials. Surfaced in the Buildohub Admin app
under "ICICI Payments (UAT)".

## 9. HMAC algorithm — important caveat

`apps/web/lib/icici/hash.ts` implements: exclude `secureHash`, sort the
remaining fields alphabetically, concatenate values only (no keys/delimiters),
HMAC-SHA256, lowercase hex output. **This repo was not supplied ICICI's
signed UAT API specification document** alongside this task — only the
high-level description in the task brief. Before going live with real ICICI
UAT credentials, confirm this exact rule against ICICI's own spec and replace
the unit tests in `hash.spec.ts` with ICICI's official sample
request/response + expected hash values.

## 10. Vercel dynamic outbound IP

Buildohub runs on Vercel Serverless with dynamic outbound IPs. The ICICI
client (`lib/icici/client.ts`) makes a plain server-to-server HTTPS `fetch()`
call — it does not assume or hard-code any static egress IP. **If ICICI's
UAT environment enforces IP allowlisting, this is an unresolved
ICICI-side/infrastructure dependency** (a future static-egress/NAT gateway
architecture would be a separate, explicitly-authorized piece of work) —
this implementation does not and must not claim to have solved it.

## 11. Testing

Automated tests (Vitest, `apps/web/lib/icici/*.spec.ts`):
- `environment.spec.ts` — UAT-only availability guard, including the
  "production + accidentally-present UAT credentials" case.
- `hash.spec.ts` — HMAC algorithm behaviour (field exclusion, sort order,
  tamper detection, secret sensitivity).
- `merchant-txn.spec.ts` — merchant transaction number format/length/
  uniqueness, payment reference format/uniqueness.

Run via `pnpm --filter @matsrc/web test` (or `pnpm exec vitest run lib/icici`
from `apps/web`).

Manual UAT gateway testing (real ICICI sandbox credentials, live redirect
through to ICICI's UAT page and back) was **not** executed as part of this
implementation and must be performed separately once real UAT merchant
credentials are provisioned and the callback URL is confirmed registered
with ICICI.

## 12. Production reactivation checklist (NOT part of this task)

Do not perform any of the following without an explicit, separate
instruction from the project owner:
- Adding `ICICI_PG_*` production credentials.
- Setting `BUILDOHUB_ENV="uat"` (or equivalent) on the production deployment.
- Pointing `ICICI_PG_BASE_URL`/`ICICI_PG_RETURN_URL` at production endpoints.
- Removing or weakening `isIciciUatAvailable()`'s environment guard.
