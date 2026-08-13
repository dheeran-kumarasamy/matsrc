# AI Sourcing Intelligence — Phase 8

## Architecture

```
Requirement → Product → Supplier → Price history → Statistics → Trend
→ Forecast → Confidence → Landed cost → Ranking → Buy-timing → Risk
→ Decision → AI explanation → UI panels
```

---

## Price History Methodology

**Source**: `PricingDistrictPriceDaily` (existing serving layer). Only `publicDisplayAllowed=true`.

**Resolution**: District-level rows → STATE fallback.

**Statistics** (`price-history.ts`): `currentPrice`, `averagePrice`, `minPrice`, `maxPrice`, `medianPrice`, `priceChangePct`, `volatilityPct` (CoV).

**Freshness**: FRESH ≤ 1 day · RECENT ≤ 7 days · STALE > 7 days · UNKNOWN.

---

## Trend Methodology

**Module**: `price-trend.ts`. Linear regression slope + CoV volatility check.

**Classification**:
- < 3 points → `INSUFFICIENT_DATA`
- CoV > 8% → `VOLATILE`
- slope > +0.05%/day → `RISING`
- slope < -0.05%/day → `FALLING`
- else → `STABLE`

**Confidence**: INSUFFICIENT_DATA (<3) · LOW (3-6) · MEDIUM (7-14) · HIGH (15+).

---

## Forecast Methodology

**Reuses**: `lib/price-forecast.ts` (`computeForecast`). OLS linear projection with widening confidence band. Minimum 3 points. `method` string displayed verbatim as UI disclosure. Never presented as guaranteed.

---

## Confidence Engine

**Module**: `confidence.ts`. Score 0–100 → HIGH (≥70) / MEDIUM (≥40) / LOW (≥1) / INSUFFICIENT_DATA (0).

Penalties: STALE freshness (−35), 0 observations (−40), VOLATILE trend (−10), no supplier price (−20), etc.

---

## Supplier Ranking

**Module**: `ranking.ts` (existing, unchanged). Score 0–100: cost 50% + delivery 20% + reliability 20% + spec-match 10%.

---

## Buy Timing

**Module**: `buy-timing.ts`. Uses `computeSignal` from `lib/price-forecast.ts` plus trend, vsAveragePct, urgency.

Outputs: `BUY_NOW` / `WAIT` / `MONITOR` / `INSUFFICIENT_DATA`.

---

## Risk Engine

**Module**: `sourcing-risk.ts`. Identifies only data-grounded risks:
`LOW_PRICE_CONFIDENCE`, `STALE_PRICE`, `INSUFFICIENT_HISTORY`, `HIGH_PRICE_VOLATILITY`, `DELIVERY_UNCERTAINTY`, `PRODUCT_MATCH_UNCERTAINTY`, `LIMITED_SUPPLIER_DATA`, `PRICE_ABOVE_AVERAGE` (>10% vs avg), `FORECAST_LOW_CONFIDENCE`.

---

## AI Boundary

AI may: explain, summarize, acknowledge gaps, answer questions.

AI must not: calculate money, invent data, change rankings, present forecasts as guaranteed, place orders.

System prompt updated in `ai/system-prompt.ts` to enforce all Phase 8 intelligence constraints.

---

## Data Gaps

Missing data is never zero. Every gap is in `dataGaps: string[]` and disclosed to the customer. Schema gaps in this version: no delivery-capability model, no MOQ column, freight from PricePoint.freight only.
