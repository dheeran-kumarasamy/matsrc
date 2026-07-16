# WhatsApp Order-Lifecycle Notifications

This module (`apps/api/src/whatsapp/lifecycle/`) sends **outbound, event-fired**
WhatsApp template messages to Builders and Suppliers as their enquiries/orders
move through their lifecycle. It is **additive** — it sits alongside, and reuses
building blocks from, two pre-existing and unrelated WhatsApp subsystems in this
repo:

- `apps/api/src/whatsapp/*` (excluding this `lifecycle/` subfolder) — the
  Supplier WhatsApp **bot** (inbound chat flows/session management). This module
  reuses its `WhatsAppSendAdapter` interface (`WHATSAPP_SEND_PROVIDER` DI token)
  and its `WhatsAppAuditHelper` (writes `AuditLog` rows tagged
  `metadata.channel: "whatsapp"`), but does **not** touch its session/flow code.
- `apps/api/src/notifications/whatsapp-alerts/*` — a separate outbound alert
  channel (watchlist price hits, order-status updates, RFQ quotes) built on
  Twilio Content Templates + `NotificationPreference.whatsappOptIn`. Unrelated;
  not modified.
- `apps/api/src/notifications/notification.service.ts` — the pre-existing
  BullMQ-based notification service used for supplier order-submission emails
  etc. Not replaced; this module's sends are fired **alongside** it, never
  instead of it.

## Why a new module instead of extending an existing one

The bot module's send path (`WhatsAppSendAdapter`) and audit trail
(`WhatsAppAuditHelper`) are the right infrastructure to reuse — same provider
abstraction, same auditability, same "traceable as `channel: whatsapp`"
requirement — but its `WhatsAppSessionService` idempotency is in-memory and
scoped to inbound chat sessions, not durable across process restarts, and not
shaped for "one message per (event, entity, day)" dedupe. This module adds its
own **durable, `AuditLog`-backed** idempotency service
(`WhatsAppLifecycleIdempotencyService`) for that reason, while still reusing
the send adapter and audit helper as-is.

## Templates implemented

All templates are Meta **Utility**-category (transactional), except where
noted. Names are configurable per-environment (see [Env vars](#env-vars)).

### Builder-facing

| Template key | Trigger |
|---|---|
| `builder_order_placed` | Builder submits an order/enquiry (checkout) |
| `builder_enquiry_pending_update` | Scheduled nudge sweep — enquiry has had no supplier decision after N hours |
| `builder_order_accepted` | Supplier accepts the enquiry |
| `builder_po_issued` | Purchase order is generated (sends the PDF as a document-header attachment) |
| `builder_payment_link` | A payment link is generated — branches on `cash` vs `bnpl_credit` |
| `builder_delivery_eta` | Order transitions toward dispatch and an ETA becomes available |
| `builder_order_dispatched` | Order status → `DISPATCHED` |
| `builder_order_out_for_delivery` | Order status → `OUT_FOR_DELIVERY` |
| `builder_order_delivered` | Order status → `DELIVERED` |

There is intentionally **no** `builder_order_rejected` template — see
[Rejections route to Admin, not the Builder](#rejections-route-to-admin-not-the-builder).

### Supplier-facing

| Template key | Trigger |
|---|---|
| `supplier_new_enquiry_notification` | Instant push, fired the moment a new enquiry/order is created for that supplier |
| `supplier_pending_enquiries_reminder` | Daily digest — count of the supplier's still-pending enquiries |
| `supplier_pending_deliveries_reminder` | Daily digest — count of the supplier's pending deliveries |
| `supplier_invoice_generated` | Invoice generated for a completed order (sends the PDF as a document-header attachment) |

## Architecture

```
orders.service.ts (builder) ─────┐
orders.service.ts (supplier) ────┼──► WhatsAppLifecycleService ──► WhatsAppSendAdapter (WHATSAPP_SEND_PROVIDER)
purchase-orders.service.ts ──────┤            │      │
enquiry-decision.flow.ts ────────┘            │      └──► WhatsAppAuditHelper (AuditLog, channel: "whatsapp")
                                               │
        WhatsAppLifecycleEnquiryNudgeSchedulerService ──► WhatsAppLifecycleService.notifyBuilderEnquiryPendingUpdate()
        WhatsAppLifecycleDailyDigestSchedulerService ───► WhatsAppLifecycleService.notifySupplierPendingEnquiriesReminder()
                                                                                  .notifySupplierPendingDeliveriesReminder()
                                               │
                                               └──► WhatsAppLifecycleIdempotencyService (durable, AuditLog-backed dedupe)
                                               └──► WhatsAppLifecycleConfigService (env-var config)
```

### `WhatsAppLifecycleService`

The single call surface every business-logic hook depends on. One public
method per template (e.g. `notifyBuilderOrderPlaced(orderId)`,
`notifySupplierNewEnquiry(orderId, supplierId)`,
`notifyBuilderOrderStatusTransition(orderId, newStatus)` — a dispatcher that
maps `OrderStatus` transitions to the correct dispatched/out-for-delivery/
delivered/ETA sends). Every method:

1. Is gated by `WhatsAppLifecycleConfigService.isEnabled()` — a no-op,
   zero-provider-calls short-circuit when disabled.
2. Builds a **dedupe key** unique to the (event, entity, and — for daily
   digests — the date), e.g. `builder-order-placed:${orderId}`,
   `supplier-pending-enquiries:${supplierId}:${yyyy-mm-dd}`.
3. Runs the actual send through
   `WhatsAppLifecycleIdempotencyService.runOnce(dedupeKey, fn)`, so a duplicate
   trigger (double webhook, duplicate scheduler tick, retried request) never
   sends the same message twice.
4. Sends via the shared `WhatsAppSendAdapter.send(to, message)` and records
   the attempt with `WhatsAppAuditHelper.record(...)`, always tagging
   `metadata.channel = "whatsapp"` plus event-specific context (order id,
   supplier id, variant, etc.) for traceability.
5. Never throws to its caller — every call site invokes these methods as
   `void this.whatsAppLifecycleService.notifyXxx(...).catch((error) => this.logger.warn(...))`,
   exactly matching the non-blocking convention already used by
   `notifications/whatsapp-alerts`.

### `WhatsAppLifecycleIdempotencyService` (durable idempotency)

`runOnce(dedupeKey, fn)`:

1. Looks up `AuditLog` for a row with `entityType: "WhatsAppLifecycleSend"` and
   `entityId: dedupeKey`. If found, returns immediately — no send, no duplicate
   audit row.
2. Otherwise runs `fn()` (the actual send + audit), then writes a new
   `WhatsAppLifecycleSend` marker row so future calls with the same key are
   recognized as duplicates.

This is deliberately **not** in-memory — it survives process restarts, and
works correctly even when the scheduler's own sweep-in-progress guard
(`sweeping` boolean, see below) isn't enough on its own (e.g. two separate
sweep ticks, or an app restart mid-sweep).

### `WhatsAppLifecycleConfigService`

Centralizes every tunable as an env var (see [Env vars](#env-vars)):
`isEnabled()`, `getEnquiryNudgeThresholdHours()`,
`getEnquiryNudgeSweepIntervalMs()`, `getDailyDigestSweepIntervalMs()`,
`getDailyDigestHour()`, `languageCode()`, `getTemplateName(key)` (per-key
override, falling back to the hardcoded default template name).

### Schedulers

Both follow the exact pattern already used by
`apps/api/src/aggregation/aggregation-scheduler.service.ts`:
`OnModuleInit`/`OnModuleDestroy` lifecycle hooks, a plain `setInterval(...).unref()`
timer (never blocks process exit), and a `sweeping` boolean guard so overlapping
ticks (a slow sweep + the next interval firing) never run concurrently.

- **`WhatsAppLifecycleEnquiryNudgeSchedulerService`** — runs every
  `WHATSAPP_ENQUIRY_NUDGE_SWEEP_INTERVAL_MS`, finds orders whose enquiry has
  been pending for longer than `WHATSAPP_ENQUIRY_NUDGE_THRESHOLD_HOURS` and
  don't yet have `reminderSentAt` set, and fires
  `notifyBuilderEnquiryPendingUpdate()` for each.
- **`WhatsAppLifecycleDailyDigestSchedulerService`** — runs every
  `WHATSAPP_DAILY_DIGEST_SWEEP_INTERVAL_MS`, but only actually sends once the
  current hour matches `WHATSAPP_DAILY_DIGEST_HOUR`; groups pending
  enquiries/deliveries per supplier and fires the two supplier reminder
  templates once per supplier per day. The scheduler's own guard prevents
  *concurrent* runs; the *durable* per-day dedupe key
  (`...:${supplierId}:${yyyy-mm-dd}`) via
  `WhatsAppLifecycleIdempotencyService` is what actually prevents a second,
  non-concurrent tick later the same day from double-sending.

Both schedulers respect `WHATSAPP_LIFECYCLE_SWEEP_DISABLED=true` as a hard
kill-switch (useful for tests and for temporarily disabling background sweeps
without touching `WHATSAPP_LIFECYCLE_ENABLED`, which also gates real-time,
non-scheduled sends).

## Document-header attachments (PO / invoice)

`BotMessage` (in `apps/api/src/whatsapp/whatsapp.types.ts`) was extended with a
document-header variant:

```ts
{ type: "document"; document: { link: string; filename?: string } }
```

`notifyBuilderPoIssued()` and `notifySupplierInvoiceGenerated()` build a
template message whose header component uses this variant, pointing at the
absolute URL of the generated PDF (via `toAbsoluteBuilderUrl()` for
builder-facing links).

## Payment-link variants (cash vs. BNPL/credit)

`notifyBuilderPaymentLink(orderId, mode)` takes an explicit `mode: "cash" |
"bnpl_credit"` and renders different template parameters/body copy for each,
recording the resolved `variant` in the audit metadata
(`metadata.variant`) so it's traceable which copy a builder actually received.

## Rejections route to Admin, not the Builder

There is **no** Builder-facing "your order was rejected" WhatsApp template.
When a supplier rejects an enquiry (`enquiry-decision.flow.ts`,
`finalizeRejection()`), the flow:

1. Sends **zero** Builder-facing WhatsApp messages.
2. Writes an `AuditLog` row via `WhatsAppAuditHelper.record(...)` with
   `action: "ENQUIRY_REJECT"`, `entityType: "Order"`, and metadata including
   `channel: "whatsapp"`, `requiresAdminAction: true`, `reason`, `builderName`,
   `supplierId`, `supplierName`, and enough context (enquiry/order id, product)
   for an Admin to act on it.

`SupplierRejectionsService` (`apps/api/src/admin/supplier-rejections/`) surfaces
these by querying `AuditLog` for rows matching
`action: "ENQUIRY_REJECT", entityType: "Order"` with
`metadata.requiresAdminAction === true` — mirroring the exact
AuditLog-querying pattern already used by
`apps/api/src/admin/whatsapp-escalations/whatsapp-escalations.service.ts`
(`findRecent()`), rather than introducing a new Prisma model. `limit` is
clamped to `[1, 200]`.

**Known limitation:** no existing Admin surfacing mechanism (badge count,
polling, push) was found beyond a plain list-fetch pattern (this is also true
of the pre-existing `whatsapp-escalations`/dispute/KYC queues). The new
`GET /admin/supplier-rejections` endpoint therefore follows that same
plain-list pattern. Wiring a badge/notification on top of it is out of scope
here and flagged rather than guessed at.

## Known limitation: `supplier_invoice_generated` has no trigger point yet

`notifySupplierInvoiceGenerated()` is fully implemented and ready to be called,
but **no invoice-generation logic exists anywhere in this codebase yet** (no
`Invoice` creation service/controller was found). Once invoicing is built, its
service should call
`this.whatsAppLifecycleService.notifySupplierInvoiceGenerated(orderId, invoicePdfUrl)`
non-blockingly, following the exact same `void ... .catch(...)` convention used
by every other call site in this module.

## Adding a new template

1. Add the new logical key to `LifecycleTemplateKey` in
   `whatsapp-lifecycle.service.ts` (or wherever the union lives).
2. Add a `WHATSAPP_TEMPLATE_<NEW_KEY>` env var override and a hardcoded
   default in `WhatsAppLifecycleConfigService.getTemplateName()`.
3. Add a new public method to `WhatsAppLifecycleService` (e.g.
   `notifyMyNewEvent(id)`) that builds a dedupe key, wraps the send in
   `idempotencyService.runOnce(...)`, sends via the shared
   `WhatsAppSendAdapter`, and audits via `WhatsAppAuditHelper.record(...)`
   with `metadata.channel: "whatsapp"`.
4. Call it from the relevant business-logic service, non-blockingly:
   ```ts
   void this.whatsAppLifecycleService
     .notifyMyNewEvent(id)
     .catch((error) => this.logger.warn(`...: ${error instanceof Error ? error.message : String(error)}`));
   ```
5. Add a Vitest spec covering: exactly-one-send-per-trigger, and (if
   scheduled/date-scoped) that a duplicate sweep doesn't double-send.

## Env vars

See `.env.example` for the full list with placeholders:

`WHATSAPP_LIFECYCLE_ENABLED`, `WHATSAPP_ENQUIRY_NUDGE_THRESHOLD_HOURS`,
`WHATSAPP_ENQUIRY_NUDGE_SWEEP_INTERVAL_MS`,
`WHATSAPP_DAILY_DIGEST_SWEEP_INTERVAL_MS`, `WHATSAPP_DAILY_DIGEST_HOUR`,
`WHATSAPP_LIFECYCLE_LANGUAGE`, `WHATSAPP_LIFECYCLE_SWEEP_DISABLED`, and one
`WHATSAPP_TEMPLATE_<KEY>` override per template listed above.

## Tests

- `whatsapp-lifecycle.service.spec.ts` — one-send-per-trigger for every
  builder/supplier template, PO-issued/invoice-generated document-header
  attachment shape, durable idempotency dedupe-key checks, the order-status
  transition dispatcher's per-status fan-out, cash-vs-BNPL payment-link
  variant rendering, and the new-enquiry push firing exactly once.
- `whatsapp-lifecycle-daily-digest-scheduler.service.spec.ts` — no-op outside
  the digest hour, one reminder per supplier per sweep, and the
  concurrent-sweep guard.
- `apps/api/src/admin/supplier-rejections/supplier-rejections.service.spec.ts`
  — rejection records include full context, non-`requiresAdminAction` rows are
  excluded, and the `limit` param is clamped.
