# AI Sourcing Assistant — Implementation Reference

> **Customer-facing positioning:**
> _Tell us what material you need. Our AI Sourcing Assistant will help you find the best sourcing option._

---

## 1. Architecture

```
Customer
   ↓
AI Sourcing Assistant UI  (/sourcing)
   ↓
Sourcing API  (POST /api/builder/sourcing/sessions/:id/message)
   ↓
AI Agent / Orchestrator  (lib/sourcing/agent.ts)
   ↓
Controlled backend tools
   ├── parse_requirement        requirement-extractor.ts  (deterministic + AI)
   ├── search_products          product-search.ts         (deterministic)
   ├── find_suppliers           supplier-search.ts        (deterministic)
   ├── get_current_prices       price-lookup.ts           (deterministic)
   ├── calculate_landed_cost    landed-cost.ts            (deterministic)
   ├── rank_suppliers           ranking.ts                (deterministic)
   ├── confirm_recommendation   session-store.ts          (audit only)
   └── Tool invocation logging  SourcingToolInvocation
   ↓
PostgreSQL
```

The LLM has **no direct database access**. It only receives structured output of deterministic services.

---

## 2. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/builder/sourcing/sessions` | List authenticated user's sessions |
| POST | `/api/builder/sourcing/sessions` | Create a new sourcing session |
| GET | `/api/builder/sourcing/sessions/:id` | Resume a session |
| POST | `/api/builder/sourcing/sessions/:id/message` | Send customer message; run sourcing turn |
| POST | `/api/builder/sourcing/sessions/:id/confirm` | Approval boundary — submit enquiry |

All endpoints require authentication. Every read/write is scoped by `userId`.

---

## 3. AI Tools

| Tool | Module | Type |
|------|--------|------|
| `parse_requirement` | `requirement-extractor.ts` | AI + deterministic fallback |
| `search_products` | `product-search.ts` | Deterministic |
| `find_suppliers` | `supplier-search.ts` | Deterministic |
| `get_current_prices` | `price-lookup.ts` | Deterministic |
| `calculate_landed_cost` | `landed-cost.ts` | Deterministic |
| `rank_suppliers` | `ranking.ts` | Deterministic |
| `get_sourcing_status` | `session-store.ts` | Read-only |
| `confirm_recommendation` | `session-store.ts` | Audit label only (customer-initiated) |

Forbidden tools (never in tool surface): `place_order`, `create_purchase_order`, `make_payment`, `update_supplier`, `update_pricing`.

---

## 4. Session Lifecycle

```
COLLECTING → SEARCHING → RECOMMENDED → CONFIRMED
                                    ↘  ABANDONED
```

Maps to `SourcingSessionStatus` enum: `COLLECTING`, `SEARCHING`, `RECOMMENDED`, `CONFIRMED`, `ABANDONED`.

---

## 5. Recommendation Lifecycle

1. `runSourcingTurn` produces `RankedSupplierOption[]` (deterministic).
2. `saveRecommendations` persists to `SourcingRecommendation`.
3. Customer reviews via `SupplierComparisonTable` + `ApprovalBar`.
4. Customer selects a `recommendationId` and clicks **Proceed**.
5. `POST /confirm` verifies ownership, pricing, active product; calls `createOrdersFromCart`.
6. Session → `CONFIRMED`; approval logged as `SourcingApprovalStatus.APPROVED`.

---

## 6. Authorization Model

- Every `SourcingSession` query includes a `userId` predicate.
- Session-not-found and session-owned-by-another-user both return `null` → 404.
- `createSession` verifies a supplied `siteId` belongs to the caller.
- The LLM has no capability to query data directly.

---

## 7. Approval Boundary

AI **may**: search, compare, calculate, rank, explain, persist recommendation.

AI **must not / cannot**: place orders, transfer money, commit contracts, modify supplier data, change pricing.

`pipeline.ts` does not import `order-checkout` or `createOrdersFromCart`.

---

## 8. Environment Variables (server-side only)

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Optional — degrades to deterministic mode |
| `ANTHROPIC_MODEL` | Model override | Optional |
| `AI_PROVIDER` | Provider selector | Optional — defaults to `anthropic` |
| `DATABASE_URL` | Prisma primary connection | Required |
| `DIRECT_URL` | Prisma direct connection | Required |
| `BACKEND_API_URL` | Internal API base for price-lookup | Optional |

**Never expose any of these via `NEXT_PUBLIC_*` or browser bundles.**

---

## 9. Feature Flag / Rollout

The `/sourcing` route is gated by `middleware.ts` authentication (same as all builder routes). For limited rollout, the nav link in `BuilderNav.tsx` can be conditionally rendered based on user role or an environment flag. Full feature-flag infrastructure is deferred.

---

## 10. Rate Limiting

Per-user in-process: 12 messages per 60-second window. HTTP 429 + `Retry-After` when exceeded. Per-instance limitation — distributed limiter is the correct future step.

---

## 11. Data Gap Handling

Missing data is never zero: every `null` field has a `dataGaps` entry. UI renders `"Not available"` — never `₹0`. Landed-cost excludes unknown components and lists them in `dataGaps`.

---

## 12. Known Limitations

- Rate limiter is per-instance (not distributed)
- No `estimatedDeliveryDays` unless a `SupplierQuote.leadTimeDays` exists
- No MOQ column in schema — `minimumOrderQuantity` always `null`
- No per-supplier delivery-capability model — `deliveryAvailable` always `null`
- Freight uses `PricePoint.freight` observations only
- Location matching is text-based (no geocoding)

---

## 13. Deferred Functionality

RFQ dispatch, WhatsApp/Email automation, automated negotiation, automatic purchasing, payment execution, delivery monitoring, supplier performance automation, market intelligence automation, distributed rate limiting, geocoded serviceability.
