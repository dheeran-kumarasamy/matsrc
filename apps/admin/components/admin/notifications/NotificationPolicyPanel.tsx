"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPatch } from "@/lib/api-client";

type NotificationPolicy = {
  id: string;
  eventType: string;
  channel: string;
  templateName: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
  priority: string;
  maxPerDay: number | null;
  cooldownMinutes: number | null;
  businessHoursOnly: boolean;
};

type GlobalSettings = {
  id: string;
  whatsappBusinessEnabled: boolean;
  whatsappMode: string;
  updatedAt: string;
  updatedBy: string | null;
} | null;

export function NotificationPolicyPanel({
  policies,
  globalSettings,
}: {
  policies: NotificationPolicy[];
  globalSettings: GlobalSettings;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [globalBusy, setGlobalBusy] = useState(false);

  async function toggleEnabled(policy: NotificationPolicy) {
    setBusyId(policy.id);
    setError(null);
    try {
      const reason = window.prompt(
        `${policy.enabled ? "Disable" : "Enable"} "${policy.displayName}" on ${policy.channel}? Optional reason:`,
        ""
      );
      if (reason === null) return; // user cancelled
      await adminApiPatch(`/admin/notifications/policies/${policy.id}`, { enabled: !policy.enabled, reason: reason || undefined });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update policy.");
    } finally {
      setBusyId(null);
    }
  }

  async function updateLimits(policy: NotificationPolicy, field: "maxPerDay" | "cooldownMinutes", value: string) {
    const parsed = value.trim() === "" ? null : Number(value);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1)) return;
    setBusyId(policy.id);
    setError(null);
    try {
      await adminApiPatch(`/admin/notifications/policies/${policy.id}`, { [field]: parsed });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update policy.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmGlobalToggle(nextEnabled: boolean) {
    setGlobalBusy(true);
    setError(null);
    try {
      const reason = window.prompt(
        nextEnabled
          ? "Re-enable ALL WhatsApp business notifications? Optional reason:"
          : "Disable ALL WhatsApp business notifications? This will stop every business template (authentication/security messages are unaffected). Optional reason:",
        ""
      );
      if (reason === null) {
        return; // user cancelled the confirmation prompt
      }
      await adminApiPatch("/admin/notifications/global-settings", { whatsappBusinessEnabled: nextEnabled, reason: reason || undefined });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update global setting.");
    } finally {
      setGlobalBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-950">Global WhatsApp Business Notifications</h3>
            <p className="mt-1 text-sm text-slate-600">
              Master switch for all business-decision WhatsApp templates. Authentication/security notifications
              (OTP, security alerts) always bypass this switch and are never affected.
            </p>
            {globalSettings ? (
              <p className="mt-1 text-xs text-slate-500">
                Current WhatsApp channel mode: <span className="font-bold">{globalSettings.whatsappMode.toUpperCase()}</span>
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                globalSettings?.whatsappBusinessEnabled ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              }`}
            >
              {globalSettings?.whatsappBusinessEnabled ? "ON" : "OFF"}
            </span>
            <button
              type="button"
              disabled={globalBusy || !globalSettings}
              onClick={() => confirmGlobalToggle(!globalSettings?.whatsappBusinessEnabled)}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {globalSettings?.whatsappBusinessEnabled ? "Disable All" : "Enable All"}
            </button>
          </div>
        </div>
      </section>

      {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}

      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Notification Templates</h3>
        <p className="mt-1 text-sm text-slate-600">
          Enable/disable individual WhatsApp/In-App templates without a code deployment or Meta Business Manager
          change. Every change is recorded to the notification policy audit log.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Event Type</th>
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3">Meta Template</th>
                <th className="py-2 pr-3">Priority</th>
                <th className="py-2 pr-3">Max/Day</th>
                <th className="py-2 pr-3">Cooldown (min)</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-sm text-slate-500">
                    No notification policies seeded yet.
                  </td>
                </tr>
              ) : (
                policies.map((policy) => (
                  <tr key={policy.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-slate-900">{policy.displayName}</div>
                      <div className="text-xs text-slate-500">{policy.eventType}</div>
                      {policy.description ? <div className="mt-1 text-xs text-slate-500">{policy.description}</div> : null}
                    </td>
                    <td className="py-2 pr-3">{policy.channel}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{policy.templateName}</td>
                    <td className="py-2 pr-3">{policy.priority}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={1}
                        defaultValue={policy.maxPerDay ?? ""}
                        onBlur={(e) => updateLimits(policy, "maxPerDay", e.target.value)}
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                        disabled={busyId === policy.id}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={1}
                        defaultValue={policy.cooldownMinutes ?? ""}
                        onBlur={(e) => updateLimits(policy, "cooldownMinutes", e.target.value)}
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                        disabled={busyId === policy.id}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${
                          policy.enabled ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        }`}
                      >
                        {policy.enabled ? "ENABLED" : "DISABLED"}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        disabled={busyId === policy.id}
                        onClick={() => toggleEnabled(policy)}
                        className="rounded border border-slate-300 px-3 py-1 text-xs font-bold text-slate-700 disabled:opacity-50"
                      >
                        {policy.enabled ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
