"use client";

import { useEffect, useState } from "react";
import { builderApiGet, builderApiPatch } from "@/lib/api";

type SiteOption = { id: string; name: string; status: "ACTIVE" | "ARCHIVED" };

// Lets the builder view and retroactively (re)tag an order to a Site for
// per-site purchase reporting. Shared between the standalone order detail
// page and the @modal overlay variant.
export default function OrderSiteAssignment({
  orderId,
  siteId: initialSiteId,
}: {
  orderId: string;
  siteId?: string | null;
}) {
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteId, setSiteId] = useState(initialSiteId ?? "");
  const [saving, setSaving] = useState(false);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    builderApiGet<SiteOption[]>("/sites")
      .then((data) => {
        if (active) setSites(data.filter((s) => s.status === "ACTIVE"));
      })
      .catch(() => {
        if (active) setSites([]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleChange(value: string) {
    setSiteId(value);
    setSaving(true);
    setSavedLabel(null);
    try {
      const updated = await builderApiPatch<{ siteId: string | null; siteName: string }>(
        `/orders/${orderId}`,
        { siteId: value || null }
      );
      setSavedLabel(updated.siteName);
    } catch {
      setSavedLabel(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-medium text-slate-500">Site:</span>
      <select
        value={siteId}
        onChange={(event) => void handleChange(event.target.value)}
        disabled={saving}
        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
      {saving ? <span className="text-slate-400">Saving…</span> : null}
      {!saving && savedLabel ? <span className="text-emerald-600">Saved</span> : null}
    </div>
  );
}
