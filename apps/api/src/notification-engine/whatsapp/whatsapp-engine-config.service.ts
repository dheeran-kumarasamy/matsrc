import { Injectable } from "@nestjs/common";

export type WhatsAppEngineMode = "live" | "dry-run" | "off";

/**
 * Central env-var config for the Notification Engine's WhatsApp channel
 * (spec Phase 6 — dry-run/mock mode, needed because the Meta "Buildohub"
 * Display Name is pending approval and real handset delivery is not yet
 * available).
 *
 * Deliberately separate from `WhatsAppAlertConfigService` (Twilio-based
 * `notifications/whatsapp-alerts` feature) and `WhatsAppLifecycleConfigService`
 * — this is the config surface for the new channel-agnostic Notification
 * Engine's WhatsApp channel (Meta Cloud API), reusing the same
 * `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` env vars already used
 * by `apps/api/src/whatsapp/adapters/meta-cloud-api-send.adapter.ts` so
 * there is exactly one Meta credential surface across the whole app.
 */
@Injectable()
export class WhatsAppEngineConfigService {
  /**
   * live | dry-run | off. Defaults to "dry-run" — safest default while Meta
   * approval is pending.
   *
   * NOTE — env var name deviation from the spec: the spec names this env
   * var `WHATSAPP_MODE`, but that name is ALREADY used by the pre-existing
   * `notifications/whatsapp-alerts` (Twilio) feature's
   * `WhatsAppAlertConfigService.getMode()`, with entirely different values
   * ("sandbox" | "production"). Reusing the same name here would silently
   * break that feature's startup validation (`validateAtStartup()` parses
   * "sandbox"/"production", not "live"/"dry-run"/"off"). To avoid a
   * collision, the Notification Engine's WhatsApp channel mode uses
   * `NOTIFICATION_ENGINE_WHATSAPP_MODE` instead — documented as an explicit
   * assumption/deviation in the deliverables report.
   */
  getMode(): WhatsAppEngineMode {
    const raw = (process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE || "dry-run").toLowerCase();
    if (raw === "live" || raw === "off") return raw;
    return "dry-run";
  }

  getPhoneNumberId(): string | undefined {
    return process.env.WHATSAPP_PHONE_NUMBER_ID;
  }

  getAccessToken(): string | undefined {
    return process.env.WHATSAPP_ACCESS_TOKEN;
  }

  getTemplateLanguage(): string {
    return process.env.WHATSAPP_TEMPLATE_LANGUAGE || process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE || "en_US";
  }

  getGraphApiVersion(): string {
    // Matches the Graph API version already adopted by
    // apps/api/src/whatsapp/adapters/meta-cloud-api-send.adapter.ts — never
    // silently bump this independently of that adapter.
    return process.env.WHATSAPP_GRAPH_API_VERSION || "v20.0";
  }

  getEndpoint(): string {
    return `https://graph.facebook.com/${this.getGraphApiVersion()}/${this.getPhoneNumberId()}/messages`;
  }
}
