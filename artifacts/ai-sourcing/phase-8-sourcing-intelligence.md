# Phase 8 — Sourcing Intelligence & Decision Engine Report

## Status: COMPLETE

---

## A. Architecture

```
Requirement
    ↓
Product matching (product-search.ts — unchanged)
    ↓
Supplier matching (supplier-search.ts — unchanged)
    ↓
Price history (sourcing-intelligence-data.ts → PricingDistrictPriceDaily)
    ↓
price-history.ts   → current price, average, min/max, volatility, freshness
price-trend.ts     → RISING / FALLING / STABLE / VOLATILE / INSUFFICIENT_DATA
lib/price-forecast.ts (existing) → computeForecast + computeSignal
confidence.ts      → HIGH / MEDIUM / LOW / INSUFFICIENT_DATA
landed-cost.ts     → deterministic (existing, unchanged)
ranking.ts         → deterministic (existing, unchanged)
buy-timing.ts      → BUY_NOW / WAIT / MONITOR / INSUFFICIENT_DATA
sourcing-risk.ts   → data-grounded risk codes
decision-engine.ts → combines all intelligence into SourcingDecision
    ↓
agent.ts → AI explanation (Anthropic Claude)
    ↓
UI: PriceIntelligenceCard + PriceHistoryChart + RiskPanel
```

---

## B. New Services

| Service | File | Responsibility |
|---------|------|----------------|
| Price history | `lib/sourcing/price-history.ts` | Daily statistics from PricingDistrictPriceDaily |
| Price trend | `lib/sourcing/price-trend.ts` | Linear regression + volatility classification |
| Confidence | `lib/sourcing/confidence.ts` | Data-quality confidence score |
| Buy timing | `lib/sourcing/buy-timing.ts` | BUY_NOW/WAIT/MONITOR decision |
| Risk engine | `lib/sourcing/sourcing-risk.ts` | Grounded risk identification |
| Scenarios | `lib/sourcing/sourcing-scenarios.ts` | What-if deterministic recalculation |
| Decision engine | `lib/sourcing/decision-engine.ts` | Central intelligence orchestrator |
| Intelligence data | `lib/sourcing/sourcing-intelligence-data.ts` | Prisma data access for intelligence |

**New UI components**:
- `components/sourcing/PriceIntelligenceCard.tsx` — current price, trend, timing
- `components/sourcing/PriceHistoryChart.tsx` — recharts historical + forecast chart
- `components/sourcing/RiskPanel.tsx` — risk and data-gap disclosure

**Modified files**:
- `lib/sourcing/pipeline.ts` — integrates intelligence + decision into turn result
- `lib/sourcing/ai/system-prompt.ts` — updated for Phase 8 intelligence constraints
- `components/sourcing/SourcingAssistant.tsx` — renders Phase 8 panels
- `components/sourcing/types.ts` — `SourcingDecisionView` type
- `app/api/builder/sourcing/sessions/[id]/message/route.ts` — exposes decision

---

## C. Methodologies

### Trend
OLS linear regression slope over daily prices. `VOLATILE` when CoV > 8%. `RISING`/`FALLING` when |slope| > 0.05%/day. Confidence by observation count: LOW (3–6), MEDIUM (7–14), HIGH (15+).

### Forecast
OLS projection with widening confidence band. Reuses `lib/price-forecast.ts` (existing). Min 3 points. Method string displayed verbatim. Never guaranteed.

### Confidence
Weighted score 0–100 from freshness, observation count, source count, trend reliability, supplier price presence. Maps to HIGH/MEDIUM/LOW/INSUFFICIENT_DATA.

### Ranking
Existing `ranking.ts` — 50% cost, 20% delivery, 20% reliability, 10% spec-match. Unchanged.

### Buy timing
`buy-timing.ts` uses `computeSignal` (lib/price-forecast.ts) + trend + vsAveragePct + urgency. Urgency forces BUY_NOW.

---

## D. UI

| Panel | When shown |
|-------|-----------|
| `PriceIntelligenceCard` | When decision.priceIntelligence is present |
| `PriceHistoryChart` | When decision.priceIntelligence is present (empty state when no data) |
| `RiskPanel` | When risks.length > 0 |

Chart clearly distinguishes Observed (blue solid) from Forecast (amber dashed). Average price shown as reference line. Forecast horizon + method shown.

---

## E. Testing

| Suite | Tests | Result |
|-------|-------|--------|
| price-history.spec.ts | 7 | ✅ |
| price-trend.spec.ts | 8 | ✅ |
| confidence.spec.ts | 6 | ✅ |
| buy-timing.spec.ts | 5 | ✅ |
| sourcing-risk.spec.ts | 13 | ✅ |
| decision-engine.spec.ts | 6 | ✅ |
| All previous sourcing tests | 151 | ✅ |
| **Web total** | **196** | **✅** |
| API tests | 274/275 | ✅ (1 pre-existing WhatsApp failure) |
| Web typecheck | — | ✅ |
| Web build | — | ✅ /sourcing: 9.61 kB |

---

## F. Security

| Check | Status |
|-------|--------|
| AI has no direct DB access | ✅ decision-engine.ts has no Prisma imports |
| AI cannot place orders | ✅ pipeline.ts does not import createOrdersFromCart |
| Authorization remains enforced | ✅ all session queries include userId predicate |
| Secrets remain server-side | ✅ no new NEXT_PUBLIC_* variables |
| AI cannot alter landed costs | ✅ decision-engine.ts packages results, never recomputes money |
| Forecasts not presented as guaranteed | ✅ method string always displayed, "estimated outlook" wording |

---

## G. Database

| Check | Status |
|-------|--------|
| Schema modified | NO |
| Migration created | NO |
| Production DB modified | NO |
| New tables created | NO |

Phase 8 reads from existing `PricingDistrictPriceDaily`, `PricingTrendMonthly`, `PricingCanonicalSku`, `PricingDistrict` — all already deployed. No schema changes required.

---

## Deferred Features

- What-if UI (scenarios engine `sourcing-scenarios.ts` is implemented but not yet wired to the UI chat flow)
- Price alert persistence (evaluation logic exists in `sourcing-risk.ts` but no alert table)
- "Should I buy now?" as an explicit chat command (timing is in the decision panel)
- "Why this price?" deep-link to district-pricing panel
- Distributed rate limiting
