import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { WhatsAppAlertTemplateKey } from "./whatsapp-alert-provider.interface";

/**
 * The three logical template keys that currently exist. Used by startup validation to
 * enumerate "all template mappings used by existing hooks" without hardcoding the list
 * in more than one place.
 */
const ALL_TEMPLATE_KEYS: WhatsAppAlertTemplateKey[] = [
  "watchlist_price_hit",
  "order_status_update",
  "rfq_quote_received",
];

/** Twilio's well-known, public WhatsApp Sandbox number (same for every Twilio account). */
export const KNOWN_TWILIO_SANDBOX_NUMBER = "+14155238886";

export type WhatsAppMode = "sandbox" | "production";

/**
 * Central place for all WhatsApp-alert-related env/config reads, following the same
 * plain-`process.env` + small-getter-service pattern already used elsewhere in this repo
 * (see `AggregationConfigService`, `MetaCloudApiSendAdapter`) rather than introducing a
 * new validation framework.
 *
 * IMPORTANT: this is deliberately kept separate from the existing `WHATSAPP_*` env vars
 * used by `apps/api/src/whatsapp/*` (the Supplier WhatsApp bot / Meta Cloud API direct
 * integration) — that is a different feature with a different provider abstraction. This
 * config only concerns outbound business alerts (watchlist/order-status/RFQ) sent
 * through `WhatsAppProvider`.
 *
 * `WHATSAPP_MODE` (sandbox|production) makes the Twilio Sandbox-vs-registered-sender
 * distinction explicit in config rather than implicit. `validateAtStartup()` runs once,
 * at Nest module-init time (via `OnModuleInit`), so a misconfiguration fails loudly at
 * boot rather than lazily the first time a send is attempted.
 */
@Injectable()
export class WhatsAppAlertConfigService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppAlertConfigService.name);

  /** Master kill-switch — when false, no WhatsApp alert send is ever attempted. */
  isEnabled(): boolean {
    return process.env.WHATSAPP_ENABLED === "true";
  }

  /** Which `WhatsAppProvider` implementation to bind — "twilio" today, "meta" later. */
  getProvider(): string {
    return process.env.WHATSAPP_PROVIDER || "twilio";
  }

  /**
   * Explicit sandbox-vs-production mode. Required whenever `WHATSAPP_ENABLED=true` —
   * see `validateAtStartup()`. Defaults to "sandbox" only for the purposes of local/dev
   * convenience when the feature is disabled outright.
   */
  getMode(): WhatsAppMode {
    const raw = (process.env.WHATSAPP_MODE || "sandbox").toLowerCase();
    return raw === "production" ? "production" : "sandbox";
  }

  /**
   * Explicit escape hatch acknowledging that the configured `TWILIO_WHATSAPP_NUMBER` is
   * intentionally NOT the known Twilio sandbox number while still running in sandbox
   * mode (e.g. a dedicated non-production sandbox-like test number). Without this flag,
   * sandbox mode + an unrecognized number fails startup — this prevents accidentally
   * treating a real/production number as a sandbox number.
   */
  isSandboxNumberOverrideEnabled(): boolean {
    return process.env.TWILIO_SANDBOX_NUMBER_OVERRIDE === "true";
  }

  getTwilioAccountSid(): string | undefined {
    return process.env.TWILIO_ACCOUNT_SID;
  }

  getTwilioAuthToken(): string | undefined {
    return process.env.TWILIO_AUTH_TOKEN;
  }

  /** Sender identity: either a WhatsApp-enabled Twilio number OR a Messaging Service SID. */
  getTwilioWhatsAppNumber(): string | undefined {
    return process.env.TWILIO_WHATSAPP_NUMBER;
  }

  getTwilioMessagingServiceSid(): string | undefined {
    return process.env.TWILIO_MESSAGING_SERVICE_SID;
  }

  /** Shared secret used to validate inbound Twilio status-callback webhook requests. */
  getTwilioStatusCallbackAuthToken(): string | undefined {
    return process.env.TWILIO_STATUS_CALLBACK_AUTH_TOKEN;
  }

  /**
   * Maps a logical template key to the actual provider-specific Content Template SID.
   * This is the ONLY place the swap-to-Meta-later work needs to touch besides adding the
   * new provider class — call sites always pass the logical key, never a raw SID.
   */
  getTwilioContentSid(templateKey: WhatsAppAlertTemplateKey): string | undefined {
    switch (templateKey) {
      case "watchlist_price_hit":
        return process.env.TWILIO_CONTENT_SID_WATCHLIST_PRICE_HIT;
      case "order_status_update":
        return process.env.TWILIO_CONTENT_SID_ORDER_STATUS_UPDATE;
      case "rfq_quote_received":
        return process.env.TWILIO_CONTENT_SID_RFQ_QUOTE_RECEIVED;
      default: {
        const exhaustiveCheck: never = templateKey;
        return exhaustiveCheck;
      }
    }
  }

  /** Normalizes a raw phone/number string for comparison (strips "whatsapp:" prefix, whitespace). */
  private normalizeNumber(raw: string): string {
    return raw.replace(/^whatsapp:/, "").trim();
  }

  private isConfiguredNumberKnownSandbox(): boolean {
    const configured = this.getTwilioWhatsAppNumber();
    if (!configured) {
      return false;
    }
    return this.normalizeNumber(configured) === KNOWN_TWILIO_SANDBOX_NUMBER;
  }

  /**
   * Runs once at Nest module-init time (app boot), before any request is served.
   * Fails loudly (throws, which prevents the app from finishing bootstrap) rather than
   * allowing a misconfiguration to only surface the first time a send is attempted.
   *
   * Validation is entirely skipped when the feature is disabled (`WHATSAPP_ENABLED`
   * is not "true"), since there is nothing unsafe about an unconfigured, disabled
   * feature.
   */
  onModuleInit(): void {
    this.validateAtStartup();
  }

  validateAtStartup(): void {
    if (!this.isEnabled()) {
      return;
    }

    const errors: string[] = [];
    const mode = this.getMode();
    const nodeEnv = (process.env.NODE_ENV || "").toLowerCase();

    if (mode === "production") {
      // Production mode must have every template-key -> template-SID mapping used by
      // the existing hooks (order-status, watchlist, RFQ) — no silent free-form fallback
      // is ever allowed in production (see `TwilioWhatsAppProvider`).
      for (const templateKey of ALL_TEMPLATE_KEYS) {
        if (!this.getTwilioContentSid(templateKey)) {
          errors.push(
            `WHATSAPP_MODE=production requires a Twilio Content Template SID for templateKey "${templateKey}", but none is configured.`
          );
        }
      }

      // Guardrail: production mode must never be pointed at the known sandbox number.
      if (this.isConfiguredNumberKnownSandbox()) {
        errors.push(
          `WHATSAPP_MODE=production but TWILIO_WHATSAPP_NUMBER is set to the known Twilio Sandbox number (${KNOWN_TWILIO_SANDBOX_NUMBER}). ` +
            "This almost certainly means a sandbox config was deployed to production. Refusing to start."
        );
      }
    } else {
      // Sandbox mode: guard against silently treating a real/production number as a
      // sandbox number, unless the operator explicitly acknowledges this.
      const configuredNumber = this.getTwilioWhatsAppNumber();
      if (
        configuredNumber &&
        !this.isConfiguredNumberKnownSandbox() &&
        !this.isSandboxNumberOverrideEnabled()
      ) {
        errors.push(
          `WHATSAPP_MODE=sandbox but TWILIO_WHATSAPP_NUMBER ("${configuredNumber}") does not match the known Twilio Sandbox number ` +
            `(${KNOWN_TWILIO_SANDBOX_NUMBER}). If this is intentional (e.g. a dedicated sandbox-like test number), set ` +
            "TWILIO_SANDBOX_NUMBER_OVERRIDE=true to acknowledge this explicitly. Refusing to start."
        );
      }

      // Guardrail: sandbox mode should never be the configured mode when the app's own
      // environment indicator says this is a production deployment.
      if (nodeEnv === "production") {
        errors.push(
          'WHATSAPP_MODE=sandbox but NODE_ENV="production". Refusing to start: this looks like a sandbox config that was ' +
            "not switched to WHATSAPP_MODE=production before a production deploy."
        );
      }
    }

    if (errors.length > 0) {
      const message = `[whatsapp-alert-config] Invalid WhatsApp alert configuration (mode="${mode}"):\n` +
        errors.map((error) => `  - ${error}`).join("\n");
      // CRITICAL: matches this repo's convention of `Logger.error` for the highest-severity
      // failures surfaced in application logs, before throwing to hard-fail app bootstrap.
      this.logger.error(message);
      throw new Error(message);
    }
  }
}
