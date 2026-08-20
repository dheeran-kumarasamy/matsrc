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
    <div className="posh-body mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="posh-eyebrow">Projects</p>
          <h1 className="posh-page-title mt-2">Sites</h1>
          <p className="posh-subtitle mt-2 max-w-2xl">
            Tag purchases to a site to see spend broken down per construction project.
          </p>
        </div>
        <button onClick={openCreateForm} className="posh-btn flex items-center gap-2">
          <Plus size={14} /> Add site
        </button>
      </header>

      {showForm ? (
        <div className="posh-card space-y-4 p-6">
          <h2 className="posh-card-title">{editingId ? "Edit site" : "New site"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              placeholder="Site name *"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="posh-input sm:col-span-2"
            />
            <input
              placeholder="Site code (optional)"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              className="posh-input"
            />
            <input
              placeholder="GSTIN (optional)"
              value={form.gstin}
              onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))}
              className="posh-input"
            />
            <input
              placeholder="Address line"
              value={form.addressLine}
              onChange={(e) => setForm((f) => ({ ...f, addressLine: e.target.value }))}
              className="posh-input sm:col-span-2"
            />
            <input
              placeholder="City"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              className="posh-input"
            />
            <input
              placeholder="State"
              value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              className="posh-input"
            />
            <input
              placeholder="Pincode"
              value={form.pincode}
              onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, "") }))}
              maxLength={6}
              className="posh-input"
            />
          </div>
          {formError ? <p className="text-xs font-bold text-[color:var(--posh-fg)]">{formError}</p> : null}
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={saving} className="posh-btn">
              {saving ? "Saving..." : editingId ? "Save changes" : "Create site"}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setForm(emptyForm);
                setEditingId(null);
              }}
              className="posh-btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="posh-card posh-muted p-10 text-center">Loading sites…</div>
      ) : error ? (
        <div className="posh-card p-10 text-center text-sm font-bold text-[color:var(--posh-fg)]">{error}</div>
      ) : sites.length === 0 ? (
        <div className="posh-card p-10 text-center">
          <MapPin className="mx-auto mb-3 text-[color:var(--posh-fg-muted)]" size={28} />
          <p className="posh-card-title">No sites yet</p>
          <p className="posh-muted mt-2 text-xs">Add your first construction site to start tagging purchases.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeSites.length > 0 ? (
            <div className="posh-card divide-y divide-[color:var(--posh-border)]">
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
              <p className="posh-eyebrow mb-2">Archived</p>
              <div className="posh-card divide-y divide-[color:var(--posh-border)] opacity-60">
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
    <div className="flex items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <p className="truncate text-base font-bold tracking-tight text-[color:var(--posh-fg)]">
          {site.name}
          {site.code ? <span className="posh-label ml-2 align-middle">({site.code})</span> : null}
        </p>
        <p className="truncate text-xs font-semibold text-[color:var(--posh-fg-muted)]">
          {[site.addressLine, site.city, site.state, site.pincode].filter(Boolean).join(", ") || "No address on file"}
        </p>
        <p className="posh-label mt-1">{site.orderCount} order(s) tagged</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onEdit}
          className="rounded-full border border-[color:var(--posh-border)] p-2 text-[color:var(--posh-fg-muted)] transition-colors hover:border-[color:var(--posh-primary)] hover:text-[color:var(--posh-fg)]"
          aria-label={`Edit ${site.name}`}
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onToggleArchive}
          disabled={archiving}
          className="rounded-full border border-[color:var(--posh-border)] p-2 text-[color:var(--posh-fg-muted)] transition-colors hover:border-[color:var(--posh-primary)] hover:text-[color:var(--posh-fg)] disabled:opacity-40"
          aria-label={site.status === "ACTIVE" ? `Archive ${site.name}` : `Restore ${site.name}`}
        >
          {site.status === "ACTIVE" ? <Archive size={14} /> : <RotateCcw size={14} />}
        </button>
      </div>
    </div>
  );
}
