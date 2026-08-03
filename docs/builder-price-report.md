# Builder Price Report ("Pricing Desk")

## Summary

Adds a Builder-facing price-intelligence report for a given canonical
product (SKU grouped across suppliers), reachable from the product detail
page (PDP) via a new "Price Desk" CTA. The report answers, entirely
on-platform: price trend over time, forecast direction, true landed cost
across suppliers, real current market context, a plain-English Buy/Hold/Wait
verdict, and lets the builder set a price alert.

All new code lives in `apps/web` and follows the existing direct-Prisma,
builder-scoped API route convention (`apps/web/app/api/builder/**`) — no
changes were made to the NestJS `apps/api` backend, and the public listings
read path (`apps/supplier`'s `/api/public/listings`, consumed via
`getSupplierListings()`) is untouched, including its `cache: "no-store"`
rule.

## Modules

1. **Buy/Hold/Wait signal** — hi-vis card, 2–3 short reasons, honestly
   reports `confidence: "low"` with a "not enough history yet" message
   rather than fabricating a verdict when there are fewer than 5 price
   snapshots.
2. **Price history** — chart/table toggle, 7D/30D/90D/1Y/All range toggle,
   honest empty state when there's no data in the selected range.
3. **Price forecast** — a transparent linear-trend projection with a
   widening confidence band (not a "black box AI prediction" — the UI
   renders `forecast.method` verbatim as its one-sentence methodology
   disclosure).
4. **Best price finder** — every active supplier offer ranked by **landed
   cost** (base price + indicative delivery + GST), with an expandable
   breakdown row per offer.
5. **Regional price variation** — groups `PriceSnapshot.region` (sourced
   from `Site.state` — there is no dedicated `Region` model in the schema)
   and shows "not enough regional data yet" when fewer than 2 regions have
   data.
6. **Live market intelligence** — a short, cached LLM+web-search summary of
   current market drivers for the product's category + region.
7. **Price alert** — reuses the existing Watchlist/target-price system
   (`WatchlistButton` component + `/api/builder/watchlist` routes)
   unmodified. No new alert backend was introduced.

## New routes (builder-scoped, `force-dynamic`)

- `GET /api/builder/products/[canonicalProductId]/report` — aggregated
  read endpoint bundling modules 1–6 in one round trip (signal, forecast,
  history, bestPrice, regional, marketInsight).
- `POST /api/builder/products/[canonicalProductId]/report/market-insight`
  — manual "Refresh" for module 6 only; rate-limited to once per 10
  minutes, returns `429` with `retryAfterMs` when called too soon.

Both routes follow the exact same auth pattern as every other
`apps/web/app/api/builder/**` route: `getUserCtx(request)` throws
`"UNAUTHENTICATED"` when the `X-User-Id`/`X-User-Email` headers are
missing, which is caught and translated to a `401` response. There is no
separate per-route RBAC middleware in this repo — role separation is
structural: builders, suppliers, and admins are entirely separate Next.js
apps (`apps/web`, `apps/supplier`, `apps/admin`) with separate sessions, so
a supplier/admin session cannot reach these routes in the first place.

## New page

- `/products/[slug]/report` — server component; resolves
  `canonicalProductId` from the slug via the same `getSupplierListings()`
  helper the PDP already uses (identical `no-store` fetch, unchanged),
  then renders `<PriceReportView canonicalProductId={...} />`.
- The existing PDP (`/products/[slug]`) gained one additive "Price Desk"
  CTA panel linking to the report page, guarded by the same
  `product.canonicalProductId` check already used by
  `PriceIntelligenceSection`. No other part of the PDP was touched.

## Schema changes (additive)

Migration: `20260802180743_add_market_insight_cache`

- New `MarketInsightCache` model, unique on `(category, region)`, storing
  `driversJson`, `outlook`, `sources` (all JSON), `generatedAt`,
  `expiresAt`. Nothing existing was altered or dropped.
- `PriceSnapshot` (pre-existing, append-only) is read directly — no schema
  change was needed for modules 2, 3, 4, or 5.

## Caching decisions

Two intentionally **different** caching rules coexist in this feature and
must not be conflated:

- **Public listings (`getSupplierListings()` / `/api/public/listings`)** —
  unchanged, still `cache: "no-store"`. This is first-party live inventory;
  stale SKUs previously caused a production incident, so this rule is
  untouched by design.
- **Market insight (`MarketInsightCache`)** — a 12-hour TTL cache in front
  of an external LLM (Anthropic Messages API) + web-search call. This is
  *not* first-party inventory — it's a slow/costly external call, so:
  - `GET /report` always reads through `getOrRefreshMarketInsight`, which
    serves the cached row if still fresh, and otherwise refreshes once and
    upserts — it never fires more than one live call per stale row per
    page view, and it is the **only** way this feature ever calls an LLM
    passively.
  - Manual "Refresh" (`forceRefreshMarketInsight`) bypasses the TTL check
    but enforces its own independent 10-minute cooldown, keyed off
    `MarketInsightCache.generatedAt`, so a builder cannot spam the
    external API.
  - On any live-call failure (network error, bad response, missing API
    key), both paths fall back to the last cached row marked `stale:
    true` rather than surfacing an error — a flaky external API should
    never break the report page. If no cached row exists yet at all, the
    module renders its own honest empty state.

## Forecast methodology (v1, intentionally swappable)

`computeForecast` in `apps/web/lib/price-forecast.ts` implements a plain
least-squares linear regression over trailing `PriceSnapshot` prices
(day-index vs. price), projected forward with a confidence band that
widens with `sqrt(1 + daysOut / n)`. This is deliberately simple and
transparent rather than a machine-learning "black box":

- The one-sentence disclosure string is defined once, in the `method`
  field of `ForecastResult`, and the UI renders it **verbatim** — so
  changing the methodology later only requires updating that one string
  plus the function body; no call site needs to change.
- If/when a more sophisticated forecasting approach is introduced (e.g.
  seasonal decomposition, a proper time-series model, or a
  vendor-provided forecast), `computeForecast`'s signature
  (`(history: HistoryPoint[], horizonDays: number) => ForecastResult`) is
  the single swap point — `computeSignal`, the aggregated report route,
  and `PriceReportView` all consume it structurally and don't care how the
  numbers were produced.
- Minimum data thresholds (`MIN_POINTS_FOR_SIGNAL = 5`,
  `MIN_POINTS_FOR_FORECAST = 3`, `MIN_POINTS_FOR_HIGH_CONFIDENCE = 20`) are
  the "no fabricated data" guardrails — the signal card and forecast chart
  both degrade to an honest low-confidence/empty state below these
  thresholds instead of inventing a plausible-looking trend.

## Landed-cost placeholders (disclosed, not final)

`estimateLandedCost` in the same file uses two **indicative** constants
until a real freight/logistics integration exists:

- `INDICATIVE_DELIVERY_FEE = ₹250` flat per order — same "confirmed at
  checkout" disclosure pattern used elsewhere in the app (e.g. `PriceGrid`
  / the site-wise/Tally feature's checkout flow). There is no
  distance-based freight model or `Region`/geo schema today, so a flat fee
  is used rather than fabricating a distance calculation.
- `DEFAULT_GST_RATE_PERCENT = 18%` — applied only when a specific rate
  isn't otherwise available, consistent with the same 18% default used for
  `OrderItem.taxRatePercent` in the site-wise/Tally feature for legacy
  rows.

Both constants are named/exported from a single place
(`apps/web/lib/price-forecast.ts`) specifically so they're easy to find
and swap out later without touching the best-price sorting logic itself.

## Environment variables

Documented in `.env.example`:

- `ANTHROPIC_API_KEY` — required for module 6 (live market intelligence).
  If unset, `fetchLiveMarketInsight` throws immediately and the module
  falls back to any existing cached row (or its own empty state if none
  exists yet) — the rest of the report is unaffected.
- `ANTHROPIC_MODEL` — optional, defaults to `claude-sonnet-4-5-20250929`.

## Testing

- `pnpm --filter web exec tsc --noEmit` — passes with zero errors across
  the whole frontend (all new files included).
- `pnpm --filter web exec vitest run` — 38/38 tests passing, including 13
  new tests in `apps/web/lib/price-forecast.spec.ts` covering:
  - `momentumOverDays` / `rangePosition` honest-null behavior on sparse
    history.
  - `computeForecast` empty-result behavior below
    `MIN_POINTS_FOR_FORECAST`, and correct slope-sign/confidence-band
    widening behavior with enough data.
  - `computeSignal` low-confidence fallback below
    `MIN_POINTS_FOR_SIGNAL`, and BUY/WAIT/HOLD branch selection.
  - `estimateLandedCost` subtotal/delivery/GST/landed-cost arithmetic.
- `pnpm --filter web run build` — full production build succeeds; the new
  routes appear correctly as dynamic (`ƒ`) routes in the build output:
  ```
  ├ ƒ /api/builder/products/[canonicalProductId]/report
  ├ ƒ /api/builder/products/[canonicalProductId]/report/market-insight
  ├ ƒ /products/[slug]/report
  ```
- No end-to-end/integration test harness exists for this feature (same
  situation as the site-wise/Tally feature) — coverage is unit-level for
  the pure statistical/cost-math functions. The aggregated report route
  and market-insight module are Prisma- and external-API-backed and would
  need either a test database or mocked Prisma/Anthropic clients to unit
  test directly.

## Manual QA checklist (for reviewer / before merge)

- [ ] Visit a product's PDP that has a `canonicalProductId`, confirm the
      "Price Desk" panel appears and links to `/products/[slug]/report`.
- [ ] On the report page, confirm all 7 modules render. For a product with
      little/no `PriceSnapshot` history, confirm the signal card, price
      history, and forecast modules show their honest empty/low-confidence
      states rather than fabricated numbers.
- [ ] Toggle the price-history range (7D/30D/90D/1Y/All) and chart/table
      view; confirm the empty state appears correctly for ranges with no
      data.
- [ ] Confirm the best-price table is sorted ascending by landed cost (not
      base price), and that expanding a row shows the base
      price/delivery/GST breakdown that sums to the landed cost shown.
- [ ] Confirm the regional module shows "not enough regional data yet"
      when fewer than 2 regions have `PriceSnapshot.region` data.
- [ ] Click "Refresh" on the market-intelligence module twice in a row;
      confirm the second attempt is rate-limited (a friendly notice,
      not an error) and that sources render as working links with a
      "(stale)" indicator once the cache is old.
- [ ] Click the price-alert control and confirm it creates/updates the
      same Watchlist entry as the existing product-page watchlist flow
      (same entry visible from both places — this feature does not create
      a separate alert record).
- [ ] Confirm hitting either new route without `X-User-Id`/`X-User-Email`
      headers returns `401`.
- [ ] Confirm the public listings page/PDP is unaffected — no visible
      regression, and `getSupplierListings()` still fetches with
      `cache: "no-store"` (unchanged in this feature).

## Known follow-ups (not blocking, tracked for a future iteration)

- No distance-based freight/logistics integration yet — landed cost uses
  a flat indicative delivery fee (see "Landed-cost placeholders" above).
- No dedicated `Region`/geo model — regional variation and market-insight
  region are both derived from the builder's `Site.state` text field.
- No feature-flag mechanism exists anywhere in this repo, so none was
  introduced for this feature; it ships directly.
- Mobile/visual QA and cross-role (supplier/admin) manual verification are
  best done in a running dev environment with seeded `PriceSnapshot` data;
  this was verified via `tsc`/`vitest`/production build in this session,
  not via a live browser session.
</content>
</invoke>
