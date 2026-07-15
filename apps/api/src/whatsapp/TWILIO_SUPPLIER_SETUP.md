# Twilio WhatsApp — Supplier Bot Setup & Testing Guide

This document covers running the Supplier WhatsApp bot (`apps/api/src/whatsapp/*`) over
**Twilio** instead of Meta Cloud API, via `WHATSAPP_ADAPTER=twilio`.

This is a completely separate integration from `notifications/whatsapp-alerts` (Twilio
outbound alerts to **builders** — see `notifications/whatsapp-alerts/NOTIFICATIONS.md`).
Both can use the same Twilio account (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`), but use
different sender numbers/Messaging Service SIDs/webhooks, configured independently.

For the Meta Cloud API alternative, see `META_SETUP.md`. Only one adapter is active at a
time, selected by `WHATSAPP_ADAPTER`.

---

## 1. Architecture summary

- **Adapter**: `apps/api/src/whatsapp/adapters/twilio-supplier-send.adapter.ts`
  (`TwilioSupplierSendAdapter`) — implements `WhatsAppSendAdapter`, selected in
  `whatsapp.module.ts`'s DI factory when `WHATSAPP_ADAPTER=twilio`.
- **Inbound webhook**: `apps/api/src/whatsapp/twilio-whatsapp.controller.ts`
  (`TwilioWhatsAppController`) — a dedicated controller (separate from the Meta-specific
  `WhatsAppController`) since Twilio's form-encoded webhook payload shape
  (`From`/`Body`/`MessageSid`/`WaId`/`ButtonText`) is structurally different from Meta's
  nested JSON. Routes:
  - `POST /whatsapp/twilio-webhook/messages` — inbound message webhook.
  - `POST /whatsapp/twilio-webhook/status` — delivery-status callback webhook.
- Both controllers converge on the same `WhatsAppRouterService.handleInboundMessage()`
  and session/flow/auth logic — no bot logic is duplicated between Meta and Twilio.
- **Interactive messages**: Twilio WhatsApp has no native "list"/"reply buttons" message
  type (unlike Meta). `list`/`buttons` `BotMessage`s are flattened into numbered
  plain-text options (e.g. `1. Update Product Price — Change price...`), and the router
  already accepts either the row id or free text/number as a reply, so this requires no
  flow changes.
- **Templates**: `kind: "template"` messages (currently only
  `supplier_otp_verification`, plus the configurable re-engagement template) are sent via
  a Twilio **Content Template SID** if one is mapped for that template name
  (`TWILIO_CONTENT_SID_SUPPLIER_*` env vars). If no SID is mapped — e.g. when testing in
  the Twilio **Sandbox**, which cannot use custom-approved Content Templates — the
  adapter falls back to a readable free-form text message instead, so the OTP flow is
  still testable end-to-end without needing production template approval.

---

## 2. Required environment variables

Add to your `.env` (see `.env.example` for the canonical list, comments included):

```
WHATSAPP_ADAPTER=twilio

# Shared with notifications/whatsapp-alerts (account-level credentials)
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""

# Dedicated to the Supplier bot — separate sender from whatsapp-alerts
TWILIO_SUPPLIER_WHATSAPP_NUMBER=""              # e.g. "+14155238886" for Sandbox
TWILIO_SUPPLIER_MESSAGING_SERVICE_SID=""        # optional; takes priority over the number above if set

# Optional — only needed once you have approved Content Templates (production)
TWILIO_CONTENT_SID_SUPPLIER_OTP_VERIFICATION=""
TWILIO_CONTENT_SID_SUPPLIER_REENGAGEMENT=""

# Optional — inbound webhook signature validation (recommended for production)
TWILIO_WEBHOOK_VALIDATE_SIGNATURE="false"
TWILIO_WEBHOOK_PUBLIC_URL=""                    # e.g. "https://api.matsrc.example.com/whatsapp/twilio-webhook/messages"
```

Leaving `WHATSAPP_ADAPTER` unset (or set to anything other than `meta`/`twilio`) keeps
the `MockWhatsAppSendAdapter` active — the safe default for local dev/CI (no real Twilio
credentials needed to run `pnpm --filter @matsrc/api test`).

---

## 3. Testing with the Twilio Sandbox (fastest way to verify end-to-end)

The Sandbox lets you test immediately with no Business Verification/template approval.

1. Go to the Twilio Console → **Messaging → Try it out → Send a WhatsApp message**
   (or **Messaging → Senders → WhatsApp Sandbox Settings**).
2. Note the Sandbox number (always `+14155238886`) and the **join code**
   (e.g. "join `some-word`").
3. From the phone you'll test with (must have WhatsApp installed), send the join code as
   a WhatsApp message to `+14155238886`. You'll get a confirmation reply — this opts that
   number into your Sandbox for ~72 hours (re-join if it expires).
4. Set your env vars:
   ```
   WHATSAPP_ADAPTER=twilio
   TWILIO_ACCOUNT_SID=<from Twilio Console → Account Info>
   TWILIO_AUTH_TOKEN=<from Twilio Console → Account Info>
   TWILIO_SUPPLIER_WHATSAPP_NUMBER=+14155238886
   ```
   Leave `TWILIO_CONTENT_SID_SUPPLIER_*` unset — Sandbox can't use custom templates, so
   the adapter will automatically fall back to free-form text for OTP messages.

5. **Expose your local API publicly** (Twilio needs a public HTTPS URL for the webhook):
   ```bash
   ngrok http 3000   # or whatever port apps/api listens on locally
   ```
6. In the Sandbox Settings page, set:
   - **"WHEN A MESSAGE COMES IN"**: `https://<your-ngrok-domain>/whatsapp/twilio-webhook/messages` (HTTP POST)
   - **"STATUS CALLBACK URL"** (optional, if you want delivery-status audit logging): `https://<your-ngrok-domain>/whatsapp/twilio-webhook/status` (HTTP POST)
7. Start the API: `pnpm --filter @matsrc/api dev` (or however you run it locally).
8. From the joined WhatsApp number, send `HI` to the Sandbox number.
9. You should receive the bot's main menu back as a flattened numbered list, e.g.:
   ```
   *Matsrc Supplier Bot*
   How can I help you today?

   1. Update Product Price — Change price of an active listing
   2. ...

   Reply with the number of your choice.
   ```
10. Reply with a number (e.g. `1`) to drive the flow, same as the Meta adapter.
11. To test OTP delivery: trigger the auth/OTP flow from an unregistered number — you
    should receive a free-form fallback message like
    `[supplier_otp_verification] 123456` (since no Content Template SID is configured in
    Sandbox mode).
12. Check the `AuditLog` table / `admin/whatsapp-escalations` to confirm inbound
    messages and (if configured) delivery-status callbacks are being recorded.

---

## 4. Going to production

1. Buy/port a dedicated WhatsApp-enabled sender number, or request a Messaging Service,
   via **Twilio Console → Messaging → Senders → WhatsApp senders** (requires WhatsApp
   Business Profile registration through Twilio, similar in spirit to Meta's Business
   Verification — follow Twilio's guided flow).
2. Create and get approval for Content Templates in the **Twilio Console → Content
   Template Builder** for:
   - `supplier_otp_verification` (Authentication category) — map its SID to
     `TWILIO_CONTENT_SID_SUPPLIER_OTP_VERIFICATION`.
   - The re-engagement template referenced by `WHATSAPP_REENGAGEMENT_TEMPLATE` — map its
     SID to `TWILIO_CONTENT_SID_SUPPLIER_REENGAGEMENT`.
3. Set `TWILIO_SUPPLIER_WHATSAPP_NUMBER` (or `TWILIO_SUPPLIER_MESSAGING_SERVICE_SID`) to
   your approved production sender.
4. Configure the sender/Messaging Service's inbound webhook and status callback to your
   real deployed URLs (same paths as in Sandbox testing, §3 step 6, but pointing at your
   production domain instead of ngrok).
5. Set `TWILIO_WEBHOOK_VALIDATE_SIGNATURE=true` and `TWILIO_WEBHOOK_PUBLIC_URL` to the
   exact inbound-message webhook URL Twilio is configured to call, so
   `TwilioWhatsAppController` validates the `X-Twilio-Signature` header on every request.
6. Keep `WHATSAPP_ADAPTER=twilio` set only in the environment(s) where this is the
   intended provider — switching between `mock`/`meta`/`twilio` requires no code changes.

---

## 5. Troubleshooting

- **No reply received**: confirm ngrok/production URL is reachable, the Sandbox/sender's
  "A MESSAGE COMES IN" webhook points at `/whatsapp/twilio-webhook/messages` (not
  `/messages/status` or the Meta `/whatsapp/webhook` path), and that
  `WHATSAPP_ADAPTER=twilio` is actually set in the running process's env (restart
  required after changing `.env`).
- **`Twilio WhatsApp send failed: ... (code=63016)`**: the 24h customer-service session
  window has closed and no Content Template SID is mapped — either have the user message
  first, or configure `TWILIO_CONTENT_SID_SUPPLIER_REENGAGEMENT`.
- **401 on the webhook**: `TWILIO_WEBHOOK_VALIDATE_SIGNATURE=true` but
  `TWILIO_WEBHOOK_PUBLIC_URL` doesn't exactly match the URL Twilio is POSTing to
  (including scheme/trailing slash) — the HMAC signature is computed over the exact URL.
- **Sandbox join expired**: re-send the join code — Sandbox opt-ins expire after
  ~72 hours of inactivity.
