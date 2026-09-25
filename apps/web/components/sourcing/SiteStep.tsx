"use client";

import { MapPin } from "lucide-react";

import type { SiteChoice } from "./types";

// "Which site is this order for?" — the AI-ordering equivalent of checkout's
// mandatory site step (see components/orders/SiteSelector.tsx), reusing the
// SAME Site model/records rather than a parallel concept.
//
// Rendering rules (feature spec §5/§12):
//   - loading: nothing shown yet (avoids a flash of "no sites" while the
//     GET /sites request is in flight)
//   - zero ACTIVE sites: explain a site is required and link to the existing
//     Sites management page to create one (no new site-creation flow)
//   - exactly one site: shown as an informational "Site selected" line —
//     already auto-applied, but still visible before confirmation
//   - multiple sites: a selectable list, mirroring SiteSelector's radio-card
//     pattern so the experience is consistent with checkout

type Props = {
  loading: boolean;
  sites: SiteChoice[];
  selectedSiteId: string | null;
  savingSiteId: string | null;
  onSelect: (siteId: string) => void;
};

export default function SiteStep({ loading, sites, selectedSiteId, savingSiteId, onSelect }: Props) {
  if (loading) return null;

  if (sites.length === 0) {
    return (
      <section className="panel space-y-2 p-4" role="alert">
        <header className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-[color:var(--posh-fg)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-800">Which site is this order for?</h2>
        </header>
        <p className="text-sm text-slate-600">
          You don&apos;t have any sites yet. A site is required before this order can be confirmed.
        </p>
        <a
          href="/sites"
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-[color:var(--posh-primary)] hover:text-[color:var(--posh-fg)]"
        >
          Add a site
        </a>
      </section>
    );
  }

  if (sites.length === 1) {
    const only = sites[0];
    const isSelected = selectedSiteId === only.id;
    return (
      <section className="panel p-4">
        <header className="mb-1 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-[color:var(--posh-fg)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-800">Site</h2>
        </header>
        <p className="text-sm text-slate-700">
          I&apos;ll place this order for: <span className="font-semibold">{only.name}</span>
          {only.location ? ` – ${only.location}` : ""}
          {isSelected ? null : savingSiteId === only.id ? " (saving…)" : ""}
        </p>
      </section>
    );
  }

  return (
    <section className="panel space-y-3 p-4">
      <header className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-[color:var(--posh-fg)]" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-slate-800">Which site is this order for?</h2>
      </header>
      <div className="space-y-2" role="radiogroup" aria-label="Select the site this order is for">
        {sites.map((site) => {
          const isSelected = selectedSiteId === site.id;
          return (
            <label
              key={site.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition"
              style={{
                borderColor: isSelected ? "var(--posh-primary)" : "var(--posh-border, #e2e8f0)",
                background: isSelected ? "rgba(var(--posh-wash-rgb, 15,23,42),0.05)" : "transparent",
              }}
            >
              <input
                type="radio"
                name="sourcing-site-selector"
                value={site.id}
                checked={isSelected}
                disabled={savingSiteId !== null}
                onChange={() => onSelect(site.id)}
                className="accent-current"
              />
              <span className="font-medium text-slate-800">
                {site.name}
                {site.location ? <span className="text-slate-400"> – {site.location}</span> : null}
              </span>
              {savingSiteId === site.id ? (
                <span className="text-xs text-slate-400">Saving…</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}
