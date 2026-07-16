# WhatsApp Cloud API (Meta) — Connection Setup Guide

This document walks through the one-time Meta/Facebook Business setup required to make
the Supplier WhatsApp bot (`apps/api/src/whatsapp/*`) work with `WHATSAPP_ADAPTER=meta`.
Nothing here requires code changes — it's all configuration in Meta's dashboards plus
setting the resulting values as env vars.

---

## 1. Create a Meta Business Account (if you don't already have one)

1. Go to https://business.facebook.com/ and create/select a **Business Portfolio**
   (formerly "Business Manager").
2. You'll need a Facebook account with admin rights on this business — this is separate
   from any personal FB profile purpose; it's just the identity Meta uses to bill/manage
   the WhatsApp Business Account (WABA).

## 2. Create a Meta App with the WhatsApp product

1. Go to https://developers.facebook.com/apps/ → **Create App**.
2. App type: **Business**.
3. Once created, on the app dashboard, click **Add Product** → find **WhatsApp** →
   **Set up**.
4. This auto-provisions:
   - A **WhatsApp Business Account (WABA)** — this maps to our `WHATSAPP_BUSINESS_ACCOUNT_ID`.
   - A **test phone number** for development (Meta gives you one for free to send to up
     to 5 verified recipient numbers before you go live) — this maps to
     `WHATSAPP_PHONE_NUMBER_ID`.

   You can find both IDs under **WhatsApp → API Setup** in the left nav of the app
   dashboard.

## 3. Get a durable access token (System User token)

The token shown by default on the "API Setup" page is a **temporary 24h token** — fine
for a first curl test, not for production.

To get a **permanent token**:

1. Go to your Business Portfolio settings: https://business.facebook.com/settings/system-users
2. Create a **System User** (role: Admin, or a scoped Employee-level user restricted to
   this one app+WABA if you want tighter least-privilege).
3. Assign the System User access to:
   - The Meta App you created.
   - The WhatsApp Business Account.
4. Generate a token for that System User:
   - Select the app.
   - Grant permissions: `whatsapp_business_messaging` and `whatsapp_business_management`.
   - Set token expiration to **Never** (System User tokens can be non-expiring, unlike
     personal user tokens).
5. Copy this token → this is `WHATSAPP_ACCESS_TOKEN`. Store it in your secrets manager
   (see §7), never commit it.

## 4. Add and verify your real sending number (for production)

The default test number can only message 5 hand-verified recipients and shows a
"This is a test number" banner in some contexts. For production:

1. **WhatsApp → API Setup → "Add phone number"**.
2. Enter the business phone number you want suppliers to see as the bot's number (must
   not already be registered on regular WhatsApp/WhatsApp Business consumer apps — Meta
   will ask you to migrate/deactivate it there first if so).
3. Verify via SMS/voice OTP.
4. Complete **Business Verification** in Meta Business Settings (required to lift the
   test-number restrictions and to get template messages beyond the trial limits) — this
   involves submitting business documents (registration certificate, GST info, etc.) and
   can take a few days to a couple of weeks.
5. Once verified, note the new **Phone Number ID** (different from the actual phone
   number, and different from the WABA ID) → `WHATSAPP_PHONE_NUMBER_ID`.

## 5. Create and get approval for the message templates this bot uses

The bot sends two kinds of template messages (`kind: "template"` in `whatsapp.types.ts`):

| Template name | Category | Used for |
|---|---|---|
| `supplier_otp_verification` | **Authentication** | OTP challenge (`whatsapp-auth.service.ts`) |
| `supplier_reengagement_nudge` (configurable via `WHATSAPP_REENGAGEMENT_TEMPLATE`) | Utility | Fallback when the 24h free-form session window has closed (Meta error 131047) |

To create them:

1. **WhatsApp Manager** (https://business.facebook.com/wa/manage/message-templates/) →
   select your WABA → **Message Templates → Create Template**.
2. For `supplier_otp_verification`:
   - Category: **Authentication**.
   - Meta provides a standardized OTP template UI — you mostly just pick "Copy code"
     button style and the code-expiry copy. This matches what the adapter sends:
     a `body` component with the code as parameter `{{1}}`, and a `button` component
     (`sub_type: "url"`, `index: 0`) also carrying the code.
3. For `supplier_reengagement_nudge`:
   - Category: **Utility** (not Marketing — Utility templates have looser rules and don't
     require opt-in the same way Marketing templates do; make sure the copy is genuinely
     transactional, e.g. "Your Matsrc order update is waiting — reply to view it").
   - Language: `en` (matches `languageCode: "en"` hardcoded in the adapter/auth service;
     update both if you add more locales — out of scope for this pass per the original
     spec).
4. Submit for review. Meta typically approves standard templates within minutes to a few
   hours; templates get rejected if the copy looks like marketing/spam, so keep it
   plain and functional.
5. **Do not send until `APPROVED`** shows in WhatsApp Manager — sending with a
   pending/rejected template name will fail with a Graph API error.

## 6. Configure the webhook

The webhook needs a **public HTTPS URL** for Meta to call. Note that `main.ts`/
`api/index.ts` call `app.setGlobalPrefix("api")`, so the actual route is
`/api/whatsapp/webhook` on whatever this API deploys to (e.g.
`https://api.matsrc.example.com/api/whatsapp/webhook`) — omitting the `/api` prefix here
is the most common cause of the webhook silently 404ing and no messages ever arriving.

### Local development (before you have a public URL)

Use a tunnel, e.g. ngrok:

```bash
ngrok http 3000   # or whatever port apps/api listens on locally
```

Take the resulting `https://xxxx.ngrok-free.app` URL and use
`https://xxxx.ngrok-free.app/api/whatsapp/webhook` below.

### Register the webhook

1. In the Meta App dashboard → **WhatsApp → Configuration**.
2. **Callback URL**: `https://<your-domain>/api/whatsapp/webhook`.

3. **Verify Token**: any string you choose — set the *same* value as
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in your env. Meta calls your `GET` endpoint with
   `hub.verify_token` and expects it to match before accepting the subscription
   (this is exactly what `WhatsAppController.verify()` checks).
4. Click **Verify and Save** — Meta immediately does a test `GET` request; your API must
   already be running and reachable at this URL with the matching token, or this step
   fails.
5. Under **Webhook fields**, subscribe to at least:
   - `messages` (inbound messages — required for the whole bot to receive anything)
   - Meta bundles delivery status events (`sent`/`delivered`/`read`/`failed`) under the
     same `messages` field's `statuses[]` array, so no separate subscription is needed
     for those.

## 7. Get the App Secret (for signature verification)

1. Meta App dashboard → **App Settings → Basic**.
2. Copy **App Secret** (click "Show", may require re-entering your password).
3. This is `WHATSAPP_APP_SECRET` — used by `WhatsAppController` to verify the
   `X-Hub-Signature-256` HMAC header on every inbound webhook POST. Required for
   production; if unset, the controller **skips signature verification entirely**
   (this is intentional, to keep local mock/dev testing working without a real secret —
   see `whatsapp.controller.ts`).

## 8. Set the environment variables

Add these to your deployment's secrets manager (Vercel Environment Variables / whatever
this repo's existing secrets approach is — **do not commit real values**, only
`.env.example` placeholders are checked in):

```
WHATSAPP_ADAPTER=meta
WHATSAPP_PHONE_NUMBER_ID=<Phone Number ID from §4>
WHATSAPP_BUSINESS_ACCOUNT_ID=<WABA ID from §2>
WHATSAPP_ACCESS_TOKEN=<System User permanent token from §3>
WHATSAPP_APP_SECRET=<App Secret from §7>
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<any strong random string, must match §6 step 3>
WHATSAPP_REENGAGEMENT_TEMPLATE=supplier_reengagement_nudge
```

Leaving `WHATSAPP_ADAPTER` unset (or set to anything other than `meta`) keeps the
`MockWhatsAppSendAdapter` active — safe default for local dev/staging/tests, and what
CI uses (no real Meta credentials needed to run `pnpm --filter @matsrc/api test`).

## 9. Verify end-to-end

1. Deploy/run the API with the env vars above set and `WHATSAPP_ADAPTER=meta`.
2. Re-check webhook subscription status in the Meta dashboard shows green/verified.
3. From a phone number you've added as a verified tester recipient (Meta App dashboard →
   WhatsApp → API Setup → "To" recipient list, required while still in test-number mode
   from §4), send `HI` to the WhatsApp Business number.
4. You should receive the main menu list message back. Check server logs / the new
   `admin/whatsapp-escalations` and `AuditLog` rows to confirm delivery-status webhooks
   (`sent`/`delivered`/`read`) are being recorded as messages are exchanged.
5. Test OTP: message from an unregistered number to trigger the OTP flow and confirm you
   receive the `supplier_otp_verification` template message with the code.

## 10. Going to full production scale

- Complete **Business Verification** (§4) to lift the test-number/messaging-limit
  restrictions — production WABAs get tiered messaging limits (250/1K/10K/100K
  conversations/24h) that increase automatically based on quality rating and volume.
- Monitor the WABA's **Quality Rating** in WhatsApp Manager — templates/numbers can be
  flagged or restricted if users block/report the number too often.
- Marketing/broadcast templates, multi-WABA support, and BSP (Business Solution
  Provider) integrations are explicitly out of scope for this bot per the original spec
  — the setup above is scoped to direct Meta Cloud API only.
