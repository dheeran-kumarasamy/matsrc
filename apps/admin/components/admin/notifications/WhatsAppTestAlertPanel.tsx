"use client";

import { useEffect, useRef, useState } from "react";
import { adminApiGet, adminApiPost } from "@/lib/api-client";

// Kept in sync with ADMIN_TEST_ALERT_TEMPLATES (apps/api/src/notification-engine/admin/dto/send-test-whatsapp-alert.dto.ts).
// NOTE: "supplier_rfq_reminder" replaces the old "supplier_quote_reminder" mapping for
// the SUPPLIER_RFQ_REMINDER business event (Meta template renamed).
const TEMPLATES = [
  "supplier_quote_alert",
  "supplier_rfq_reminder",
  "customer_order_status",
  "supplier_po_alert",
  "supplier_price_update",
  "quote_received",
  "action_reminder_alert",
] as const;

type WhatsAppMessageLog = {
  id: string;
  phoneNumber: string;
  templateName: string;
  direction: string;
  status: string;
  mode: string;
  metaMessageId: string | null;
  errorDetails: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "sent":
    case "delivered":
    case "read":
      return "bg-green-50 text-green-700";
    case "failed":
      return "bg-red-50 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function WhatsAppTestAlertPanel({ mode, initialLogs }: { mode: string; initialLogs: WhatsAppMessageLog[] }) {
  const [phone, setPhone] = useState("");
  const [templateName, setTemplateName] = useState<string>(TEMPLATES[0]);
  const [parametersText, setParametersText] = useState("");
  const [logs, setLogs] = useState(initialLogs);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refreshLogs() {
    try {
      const latest = await adminApiGet<WhatsAppMessageLog[]>("/admin/whatsapp-alerts/logs?limit=50");
      setLogs(latest);
    } catch {
      // best-effort — keep showing the last known logs
    }
  }

  useEffect(() => {
    refreshTimer.current = setInterval(refreshLogs, 8000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSend() {
    setSending(true);
    setError(null);
    setLastResult(null);
    try {
      const parameters = parametersText
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const result = await adminApiPost<{ status: string; metaMessageId?: string; errorDetails?: string }>(
        "/admin/whatsapp-alerts/test-alert",
        { phone, templateName, parameters }
      );
      setLastResult(
        `${result.status.toUpperCase()}${result.metaMessageId ? ` — ${result.metaMessageId}` : ""}${
          result.errorDetails ? ` — ${result.errorDetails}` : ""
        }`
      );
      await refreshLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send test alert.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-950">WhatsApp Alerts — Test Page</h3>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
            Current mode: {mode.toUpperCase()}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Send a test WhatsApp template alert. In <strong>dry-run</strong> mode no real Meta API call is made — a
          message log row is created and simulated as sent with a mock message id, so this page is fully usable
          before Meta approves the &ldquo;Buildohub&rdquo; Display Name.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Phone number
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="919876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Template
            <select
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            >
              {TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            Parameters (comma-separated)
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Acme Steel, 2, TMT 10mm"
              value={parametersText}
              onChange={(e) => setParametersText(e.target.value)}
            />
          </label>
        </div>

        {error ? <p className="mt-3 text-xs font-semibold text-red-700">{error}</p> : null}
        {lastResult ? <p className="mt-3 text-xs font-semibold text-slate-700">Result: {lastResult}</p> : null}

        <button
          type="button"
          disabled={sending || !phone || !templateName}
          onClick={handleSend}
          className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send Test Alert"}
        </button>
      </section>

      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Recent WhatsApp Logs</h3>
        <p className="mt-1 text-xs text-slate-500">Auto-refreshes every 8 seconds.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Phone</th>
                <th className="py-2 pr-3">Template</th>
                <th className="py-2 pr-3">Created</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Meta Message ID</th>
                <th className="py-2 pr-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No WhatsApp logs yet.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{log.phoneNumber}</td>
                    <td className="py-2 pr-3">{log.templateName}</td>
                    <td className="py-2 pr-3">{formatDateTime(log.createdAt)}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusBadgeClass(log.status)}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{log.metaMessageId ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs text-red-700">{log.errorDetails ?? "—"}</td>
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
