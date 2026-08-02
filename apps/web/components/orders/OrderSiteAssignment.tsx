"use client";

import { useEffect, useState } from "react";
import { MapPin, Plus, X } from "lucide-react";
import { builderApiGet, builderApiPatch, builderApiPost } from "@/lib/api";
import MapLocationPicker from "@/components/cart/MapLocationPicker";

type SiteOption = { id: string; name: string; status: "ACTIVE" | "ARCHIVED" };

type NewSiteForm = {
  name: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
};

const emptyNewSiteForm: NewSiteForm = {
  name: "",
  addressLine: "",
  city: "",
  state: "",
  pincode: "",
  lat: null,
  lng: null,
};

// Lets the builder view and retroactively (re)tag an order to a Site for
// per-site purchase reporting. Shared between the standalone order detail
// page and the @modal overlay variant. Also lets the builder create a
// brand-new site inline (name + address + optional geolocation pin) —
// mirroring the same "+ Add new site…" flow available at checkout
// (see components/orders/SiteSelector.tsx) — and immediately tags this
// order to it once created.
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

  const [showNewSiteForm, setShowNewSiteForm] = useState(false);
  const [form, setForm] = useState<NewSiteForm>(emptyNewSiteForm);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
    if (value === "__new__") {
      setShowNewSiteForm(true);
      setCreateError(null);
      return;
    }

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

  function handleUseMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((f) => ({ ...f, lat: position.coords.latitude, lng: position.coords.longitude }));
      },
      () => {
        /* silently ignore — map picker/manual entry still available */
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function handleCreateSite() {
    if (!form.name.trim()) {
      setCreateError("Site name is required.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await builderApiPost<SiteOption & { lat: number | null; lng: number | null }>(
        "/sites",
        {
          name: form.name.trim(),
          addressLine: form.addressLine.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          pincode: form.pincode.trim() || undefined,
          lat: form.lat ?? undefined,
          lng: form.lng ?? undefined,
        }
      );
      setSites((prev) => [...prev, { id: created.id, name: created.name, status: "ACTIVE" }]);
      setShowNewSiteForm(false);
      setForm(emptyNewSiteForm);
      // Immediately tag this order to the newly created site, same as
      // picking an existing site from the dropdown.
      await handleChange(created.id);
    } catch (err: any) {
      setCreateError(
        err?.message?.includes("409")
          ? "A site with this name already exists."
          : "Unable to create this site right now."
      );
    } finally {
      setCreating(false);
    }
  }

  if (showNewSiteForm) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">New site</p>
          <button
            type="button"
            onClick={() => {
              setShowNewSiteForm(false);
              setForm(emptyNewSiteForm);
              setCreateError(null);
            }}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Cancel new site"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <input
            placeholder="Site name *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            placeholder="Address line"
            value={form.addressLine}
            onChange={(e) => setForm((f) => ({ ...f, addressLine: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            placeholder="City"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="State"
            value={form.state}
            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="Pincode"
            value={form.pincode}
            maxLength={6}
            onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, "") }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
          />
        </div>

        <div>
          <button
            type="button"
            onClick={handleUseMyLocation}
            className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <MapPin size={12} /> Use my current location
          </button>
          <MapLocationPicker
            lat={form.lat}
            lng={form.lng}
            onLocationSelect={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))}
          />
          {form.lat !== null && form.lng !== null ? (
            <p className="mt-1 text-[11px] text-emerald-700">
              Location pin set ({form.lat.toFixed(4)}, {form.lng.toFixed(4)})
            </p>
          ) : null}
        </div>

        {createError ? <p className="text-xs text-red-600">{createError}</p> : null}

        <button
          type="button"
          onClick={() => void handleCreateSite()}
          disabled={creating}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-700 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          <Plus size={14} /> {creating ? "Creating…" : "Create site & tag order"}
        </button>
      </div>
    );
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
        <option value="__new__">+ Add new site…</option>
      </select>
      {saving ? <span className="text-slate-400">Saving…</span> : null}
      {!saving && savedLabel ? <span className="text-emerald-600">Saved</span> : null}
    </div>
  );
}
