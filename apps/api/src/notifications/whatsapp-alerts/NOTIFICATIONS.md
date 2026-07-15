# WhatsApp Business Alerts

This module (`apps/api/src/notifications/whatsapp-alerts/`) sends outbound
WhatsApp notifications for three business events:

- `watchlist_price_hit` — a builder's watched product hits their target price
  (triggered from `apps/api/src/supplier/listings/listings.service.ts`)
- `order_status_update` — an order's status changes
  (triggered from `apps/api/src/supplier/orders/orders.service.ts`)
- `rfq_quote_received` — a best-price RFQ quote is finalized for a builder
  (triggered from `apps/api/src/supplier/rfqs/rfqs.service.ts`)

This is **additive** — it sits alongside the pre-existing notification channels
(email/SMS/push/in-app via `NotificationService`) and the unrelated, pre-existing
Supplier WhatsApp bot module at `apps/api/src/whatsapp/` (inbound flows/session
management for suppliers). Nothing in either of those was changed.

## Design goals

1. **Zero regression** — existing channels are untouched; this is a new,
   independent call fired alongside them.
2. **Non-blocking** — every call site fires `whatsAppAlertService.sendXxx(...)`
   with `void ... .catch((error) => logger.warn(...))`. A WhatsApp failure never
   throws, never rolls back, and never blocks the underlying business operation.
3. **Feature-flagged** — gated by `WHATSAPP_ENABLED` (env var, read at request
   time via `WhatsAppAlertConfigService.isEnabled()`), so it can be toggled
   without a redeploy.
4. **Opt-in only** — `WhatsAppAlertService` will not attempt to send unless the
   target user's `NotificationPreference.whatsappOptIn` is `true`. No opt-in,
   no send attempt, regardless of the flag.
5. **Provider-agnostic call sites** — business logic (`orders.service.ts`,
   `rfqs.service.ts`, `listings.service.ts`) only ever calls
   `WhatsAppAlertService`, which only ever calls the `WhatsAppProvider`
   interface. Swapping providers means adding a new class and touching the DI
   factory in `whatsapp-alerts.module.ts` — never the call sites.

## Architecture

```
orders.service.ts ─┐
rfqs.service.ts ────┼──► WhatsAppAlertService ──► WhatsAppProvider (interface)
listings.service.ts ┘         │                          │
                               │                          └── TwilioWhatsAppProvider (current)
                               │                          └── MetaWhatsAppAlertProvider (future)
                               │
                               └── WhatsAppAlertConfigService (env/config reads)
                               └── NotificationDeliveryLog / Notification (Prisma, audit trail)

Twilio ──POST /whatsapp-alerts/status──► WhatsAppStatusController ──► Notification/NotificationDeliveryLog
```

### `WhatsAppProvider` interface

Defined in `whatsapp-alert-provider.interface.ts`:

```ts
type WhatsAppAlertTemplateKey =
  | "watchlist_price_hit"
  | "order_status_update"
  | "rfq_quote_received";

type WhatsAppSendTemplateParams = Record<string, string>;

interface WhatsAppSendTemplateResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

interface WhatsAppProvider {
  sendTemplateMessage(
    to: string,
    templateKey: WhatsAppAlertTemplateKey,
    params: WhatsAppSendTemplateParams
  ): Promise<WhatsAppSendTemplateResult>;
}
```

`templateKey` is a **logical** alert type, not a raw provider template ID. The
mapping from `templateKey` → provider-specific template identifier lives
entirely in `WhatsAppAlertConfigService` (e.g. `getTwilioContentSid(templateKey)`
maps to the `TWILIO_CONTENT_SID_*` env vars). This is what makes provider swaps
possible without touching call sites — a new provider just needs its own
mapping method reading its own env vars.

### `TwilioWhatsAppProvider` (current implementation)

- Lazily constructs the Twilio SDK client from `TWILIO_ACCOUNT_SID` /
  `TWILIO_AUTH_TOKEN`.
- Sends via WhatsApp **Content Templates** (`contentSid` + `contentVariables`),
  not free-form text, using either `TWILIO_MESSAGING_SERVICE_SID` or
  `TWILIO_WHATSAPP_NUMBER` as the sender.
- Never throws — all failures are caught and returned as
  `{ success: false, error }`.
- Retries with exponential backoff (`BASE_BACKOFF_MS * 2^attempt`, up to
  `MAX_RETRIES`) only for transient/5xx/429-style failures. Known **permanent**
  Twilio error codes (invalid number, unapproved template, etc. — see
  `PERMANENT_ERROR_CODES`) fail fast with no retry.

### `WhatsAppAlertService` (orchestrator)

Public methods: `sendOrderStatusUpdate()`, `sendWatchlistPriceHit()`,
`sendRfqQuoteReceived()`. Each delegates to a private `sendGated()` which:

1. Checks `WhatsAppAlertConfigService.isEnabled()` — if `false`, returns
   immediately, zero provider calls.
2. Loads the target `user` + `notificationPreference`; if
   `notificationPreference?.whatsappOptIn !== true`, returns immediately, zero
   provider calls.
3. Resolves the destination number (`user.whatsappNumber || user.phone`).
4. Calls `provider.sendTemplateMessage(...)`.
5. Records the attempt via `recordAttempt()` — writes/updates a `Notification`
   row keyed by an idempotency key
   (`whatsapp-alert:${templateKey}:${sourceReferenceId}:${userId}`) and a
   `NotificationDeliveryLog` row, so every send is traceable back to its
   originating order/watchlist/enquiry.

The whole method is wrapped in an outer `try/catch` so it **never throws** to
callers, regardless of what goes wrong internally.

## Delivery-status webhook

`WhatsAppStatusController` (`POST /whatsapp-alerts/status`) receives Twilio's
status callbacks (`queued` / `sent` / `delivered` / `failed` / `undelivered`)
and updates the matching `Notification` row (looked up by
`externalId === MessageSid`), plus appends a `NotificationDeliveryLog` entry.
Every log line includes the `idempotencyKey` for full traceability back to the
original alert.

**Known deviation:** signature verification here is a simplified shared-secret
HMAC-SHA256-over-`MessageSid` scheme (keyed by
`TWILIO_STATUS_CALLBACK_AUTH_TOKEN`), matching the simpler pattern already used
by this repo's pre-existing Meta webhook (`WhatsAppController.isValidSignature`
in `apps/api/src/whatsapp/whatsapp.controller.ts`). It does **not** implement
Twilio's actual `X-Twilio-Signature` spec (HMAC-SHA1 over the full callback URL
+ sorted POST params), since that requires knowing the exact public callback
URL configured in the Twilio console, which isn't available in this codebase's
current config pattern. Verification is skipped entirely (dev-friendly) when
`TWILIO_STATUS_CALLBACK_AUTH_TOKEN` is unset.

## Adding a new template/alert type

1. Add the new logical key to `WhatsAppAlertTemplateKey` in
   `whatsapp-alert-provider.interface.ts`.
2. Add a `TWILIO_CONTENT_SID_<NEW_KEY>` env var and map it in
   `WhatsAppAlertConfigService.getTwilioContentSid()`.
3. Add a new public method to `WhatsAppAlertService` (e.g.
   `sendMyNewAlert(params)`) that calls `sendGated("my_new_key", ...)`.
4. Call it from the relevant business-logic service, non-blockingly:
   ```ts
   void this.whatsAppAlertService
     .sendMyNewAlert({ userId, ... })
     .catch((error) => this.logger.warn(`...: ${error instanceof Error ? error.message : String(error)}`));
   ```

## Swapping to a future Meta Cloud API provider

The Twilio integration is explicitly an **interim** provider. To swap to Meta's
WhatsApp Cloud API later, without touching any call site:

1. Create `MetaWhatsAppAlertProvider implements WhatsAppProvider` in this same
   directory, implementing `sendTemplateMessage()` against the Meta Graph API
   (the existing, unrelated `apps/api/src/whatsapp/adapters/meta-cloud-api-send.adapter.ts`
   is a useful reference for auth/retry conventions already used in this repo).
2. Add corresponding config getters to `WhatsAppAlertConfigService` (e.g.
   `getMetaContentTemplateName(templateKey)`), reading whatever new env vars
   Meta requires.
3. In `whatsapp-alerts.module.ts`, register the new provider class and extend
   the `WHATSAPP_ALERT_PROVIDER` factory:
   ```ts
   useFactory: (twilio: TwilioWhatsAppProvider, meta: MetaWhatsAppAlertProvider, config: WhatsAppAlertConfigService) =>
     config.getProvider() === "meta" ? meta : twilio,
   inject: [TwilioWhatsAppProvider, MetaWhatsAppAlertProvider, WhatsAppAlertConfigService],
   ```
4. Flip `WHATSAPP_PROVIDER=meta` in env — done. `WhatsAppAlertService` and every
   call site (`orders.service.ts`, `rfqs.service.ts`, `listings.service.ts`)
   require **zero** changes, since they only ever depend on the
   `WhatsAppProvider` interface via `WHATSAPP_ALERT_PROVIDER`.

## Env vars

See `.env.example` for the full list with placeholders:
`WHATSAPP_ENABLED`, `WHATSAPP_PROVIDER`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`,
`TWILIO_CONTENT_SID_WATCHLIST_PRICE_HIT`,
`TWILIO_CONTENT_SID_ORDER_STATUS_UPDATE`,
`TWILIO_CONTENT_SID_RFQ_QUOTE_RECEIVED`,
`TWILIO_STATUS_CALLBACK_AUTH_TOKEN`.
