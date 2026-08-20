"use client";

// Shared "tag this order to a site" control used by both checkout flows
// (the cart drawer overlay and the standalone /checkout page). Lets a
// builder pick an existing ACTIVE site OR create a brand-new one inline —
// with name, address, and an optional map pin — without leaving checkout.
//
// On creating a new site, it POSTs to /api/builder/sites (existing CRUD
// endpoint) and immediately selects the newly created site's id.

import { useEffect, useState } from "react";
import { MapPin, Plus, X } from "lucide-react";
import { builderApiGet, builderApiPost } from "@/lib/api";
import MapLocationPicker from "@/components/cart/MapLocationPicker";

export type SiteOption = {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
};

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

export default function SiteSelector({
  value,
  onChange,
  label = "Tag this order to a site (optional)",
}: {
  value: string;
  onChange: (siteId: string) => void;
  label?: string;
}) {
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewSiteForm, setShowNewSiteForm] = useState(false);
  const [form, setForm] = useState<NewSiteForm>(emptyNewSiteForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    builderApiGet<SiteOption[]>("/sites")
      .then((data) => {
        if (active) setSites(data.filter((s) => s.status === "ACTIVE"));
      })
      .catch(() => {
        if (active) setSites([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleSelectChange(next: string) {
    if (next === "__new__") {
      setShowNewSiteForm(true);
      setError(null);
      return;
    }
    onChange(next);
  }

  async function handleCreateSite() {
    if (!form.name.trim()) {
      setError("Site name is required.");
      return;
    }
    setSaving(true);
    setError(null);
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
      onChange(created.id);
      setShowNewSiteForm(false);
      setForm(emptyNewSiteForm);
    } catch (err: any) {
      setError(
        err?.message?.includes("409")
          ? "A site with this name already exists."
          : "Unable to create this site right now."
      );
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

  if (loading) {
    return <p className="text-xs text-slate-400">Loading sites…</p>;
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>

      {!showNewSiteForm ? (
        <div className="flex flex-wrap gap-2">
          <select
            value={value}
            onChange={(event) => handleSelectChange(event.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Unassigned</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
            <option value="__new__">+ Add new site…</option>
          </select>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">New site</p>
            <button
              type="button"
              onClick={() => {
                setShowNewSiteForm(false);
                setForm(emptyNewSiteForm);
                setError(null);
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
              className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-[color:var(--posh-bg-card)] px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
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

          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          <button
            type="button"
            onClick={() => void handleCreateSite()}
            disabled={saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[color:var(--posh-primary)] py-2 text-xs font-semibold text-[color:var(--posh-primary-fg)] hover:opacity-85 disabled:opacity-50"
          >
            <Plus size={14} /> {saving ? "Creating…" : "Create site & tag order"}
          </button>
        </div>
      )}
    </div>
  );
}
