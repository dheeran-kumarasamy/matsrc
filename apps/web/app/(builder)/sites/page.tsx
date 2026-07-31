"use client";

import { useEffect, useState } from "react";
import { MapPin, Plus, Archive, RotateCcw, Pencil } from "lucide-react";
import { builderApiGet, builderApiPost, builderApiPatch } from "@/lib/api";

type Site = {
  id: string;
  name: string;
  code: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  status: "ACTIVE" | "ARCHIVED";
  orderCount: number;
};

type SiteFormState = {
  name: string;
  code: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
};

const emptyForm: SiteFormState = {
  name: "",
  code: "",
  addressLine: "",
  city: "",
  state: "",
  pincode: "",
  gstin: "",
};

// Builder Sites/Projects management — lets a builder tag purchases to
// specific construction sites for per-site reporting (see Site-wise
// purchase reports spec, Phase 2).
export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SiteFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  async function loadSites() {
    try {
      const payload = await builderApiGet<Site[]>("/sites");
      setSites(payload);
      setError(null);
    } catch {
      setError("Unable to load sites right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSites();
  }, []);

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(site: Site) {
    setEditingId(site.id);
    setForm({
      name: site.name,
      code: site.code ?? "",
      addressLine: site.addressLine ?? "",
      city: site.city ?? "",
      state: site.state ?? "",
      pincode: site.pincode ?? "",
      gstin: site.gstin ?? "",
    });
    setFormError(null);
    setShowForm(true);
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      setFormError("Site name is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        addressLine: form.addressLine.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        gstin: form.gstin.trim() || undefined,
      };
      if (editingId) {
        await builderApiPatch(`/sites/${editingId}`, body);
      } else {
        await builderApiPost("/sites", body);
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      await loadSites();
    } catch (err: any) {
      setFormError(
        err?.message?.includes("409")
          ? "A site with this name already exists."
          : "Unable to save this site right now."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleArchive(site: Site) {
    setArchivingId(site.id);
    try {
      await builderApiPatch(`/sites/${site.id}`, {
        status: site.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
      });
      await loadSites();
    } finally {
      setArchivingId(null);
    }
  }

  const activeSites = sites.filter((s) => s.status === "ACTIVE");
  const archivedSites = sites.filter((s) => s.status === "ARCHIVED");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Projects</p>
          <h1 className="text-2xl font-bold text-slate-900">Sites</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tag purchases to a site to see spend broken down per construction project.
          </p>
        </div>
        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          <Plus size={16} /> Add site
        </button>
      </div>

      {showForm ? (
        <div className="panel space-y-3 p-5">
          <h2 className="font-semibold text-slate-800">{editingId ? "Edit site" : "New site"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              placeholder="Site name *"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
            />
            <input
              placeholder="Site code (optional)"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              placeholder="GSTIN (optional)"
              value={form.gstin}
              onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
              onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, "") }))}
              maxLength={6}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          {formError ? <p className="text-xs text-red-600">{formError}</p> : null}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : editingId ? "Save changes" : "Create site"}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setForm(emptyForm);
                setEditingId(null);
              }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="panel p-10 text-center text-sm text-slate-400">Loading sites…</div>
      ) : error ? (
        <div className="panel p-10 text-center text-sm text-red-600">{error}</div>
      ) : sites.length === 0 ? (
        <div className="panel p-10 text-center">
          <MapPin className="mx-auto mb-2 text-slate-300" size={28} />
          <p className="text-sm text-slate-400">No sites yet. Add your first construction site to start tagging purchases.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeSites.length > 0 ? (
            <div className="panel divide-y divide-slate-100">
              {activeSites.map((site) => (
                <SiteRow
                  key={site.id}
                  site={site}
                  onEdit={() => openEditForm(site)}
                  onToggleArchive={() => handleToggleArchive(site)}
                  archiving={archivingId === site.id}
                />
              ))}
            </div>
          ) : null}

          {archivedSites.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Archived</p>
              <div className="panel divide-y divide-slate-100 opacity-70">
                {archivedSites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    onEdit={() => openEditForm(site)}
                    onToggleArchive={() => handleToggleArchive(site)}
                    archiving={archivingId === site.id}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SiteRow({
  site,
  onEdit,
  onToggleArchive,
  archiving,
}: {
  site: Site;
  onEdit: () => void;
  onToggleArchive: () => void;
  archiving: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">
          {site.name}
          {site.code ? <span className="ml-2 text-xs font-normal text-slate-400">({site.code})</span> : null}
        </p>
        <p className="truncate text-xs text-slate-500">
          {[site.addressLine, site.city, site.state, site.pincode].filter(Boolean).join(", ") || "No address on file"}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">{site.orderCount} order(s) tagged</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onEdit}
          className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:border-blue-200 hover:text-blue-700"
          aria-label={`Edit ${site.name}`}
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onToggleArchive}
          disabled={archiving}
          className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:border-amber-200 hover:text-amber-700 disabled:opacity-40"
          aria-label={site.status === "ACTIVE" ? `Archive ${site.name}` : `Restore ${site.name}`}
        >
          {site.status === "ACTIVE" ? <Archive size={14} /> : <RotateCcw size={14} />}
        </button>
      </div>
    </div>
  );
}
