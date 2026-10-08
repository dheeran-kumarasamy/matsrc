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
