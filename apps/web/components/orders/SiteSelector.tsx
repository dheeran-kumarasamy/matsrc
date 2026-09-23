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
  onSelectSite,
  label = "Tag this order to a site (optional)",
  required = false,
  autoOpenAddSiteWhenEmpty = false,
}: {
  value: string;
  onChange: (siteId: string) => void;
  // Optional: also receive the full SiteOption (e.g. to display the site's
  // name elsewhere in the checkout flow without a second lookup).
  onSelectSite?: (site: SiteOption | null) => void;
  label?: string;
  // Checkout (enquiry basket) flow requires a Site to be selected before
  // placing an enquiry — see components/cart/CartDrawer.tsx and
  // app/(builder)/checkout/page.tsx. Other (non-checkout) usages of this
  // component keep the original optional "Unassigned" dropdown behaviour.
  required?: boolean;
  // When true (checkout flow) and the builder has zero sites, the
  // "Add New Site" form opens automatically instead of showing an empty
  // dropdown with nothing to select.
  autoOpenAddSiteWhenEmpty?: boolean;
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
        if (!active) return;
        const activeSites = data.filter((s) => s.status === "ACTIVE");
        setSites(activeSites);
        if (autoOpenAddSiteWhenEmpty && activeSites.length === 0) {
          setShowNewSiteForm(true);
        }
      })
      .catch(() => {
        if (!active) return;
        setSites([]);
        if (autoOpenAddSiteWhenEmpty) setShowNewSiteForm(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [autoOpenAddSiteWhenEmpty]);

  function handleSelectChange(next: string) {
    if (next === "__new__") {
      setShowNewSiteForm(true);
      setError(null);
      return;
    }
    onChange(next);
    onSelectSite?.(sites.find((s) => s.id === next) ?? null);
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
      const newSite: SiteOption = { id: created.id, name: created.name, status: "ACTIVE" };
      setSites((prev) => [...prev, newSite]);
      onChange(created.id);
      onSelectSite?.(newSite);
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

  // Checkout flow (required=true): builder has no sites yet — force the
  // "Add New Site" form with no way to dismiss it (a site is mandatory to
  // place an enquiry), instead of showing the generic dropdown UI.
  const noSitesYet = required && sites.length === 0;
  const canCancelNewSiteForm = !noSitesYet;

  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
        {required ? "Select Site" : label}
      </label>

      {!showNewSiteForm && noSitesYet ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-center">
          <p className="text-sm font-semibold text-slate-700">No sites added yet</p>
          <p className="mt-1 text-xs text-slate-500">Add a site to continue with your enquiry.</p>
          <button
            type="button"
            onClick={() => {
              setShowNewSiteForm(true);
              setError(null);
            }}
            className="posh-btn-solid mt-3 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold"
          >
            <Plus size={14} /> Add New Site
          </button>
        </div>
      ) : !showNewSiteForm ? (
        required ? (
          <div className="space-y-2">
            {sites.map((site) => (
              <label
                key={site.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition"
                style={{
                  borderColor: value === site.id ? "var(--posh-primary)" : "var(--posh-border, #e2e8f0)",
                  background: value === site.id ? "rgba(var(--posh-wash-rgb, 15,23,42),0.05)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="checkout-site-selector"
                  value={site.id}
                  checked={value === site.id}
                  onChange={() => {
                    onChange(site.id);
                    onSelectSite?.(site);
                  }}
                  className="accent-current"
                />
                <span className="font-medium text-slate-800">{site.name}</span>
              </label>
            ))}
            <button
              type="button"
              onClick={() => {
                setShowNewSiteForm(true);
                setError(null);
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              <Plus size={14} /> Add New Site
            </button>
          </div>
        ) : (
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
        )
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">New site</p>
            {canCancelNewSiteForm ? (
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
            ) : null}
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
            className="posh-btn-solid flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold disabled:opacity-50"
          >
            <Plus size={14} /> {saving ? "Creating…" : "Create site & tag order"}
          </button>
        </div>
      )}
    </div>
  );
}
