"use client";

import { MapPin } from "lucide-react";

import type { SiteChoice, SiteSelectionReason } from "./types";

// "Which site is this order for?" — now LOCATION-AWARE (see
// lib/sourcing/site-location-matcher.ts for the single authoritative
// matching service this component's props are derived from). The number of
// active sites alone must never decide the selected site — see the feature
// spec "Make AI Site Selection Location-Aware".
//
// States (feature spec §19):
//   A. loading                          -> nothing
//   B. location unknown, 0 sites        -> "add a site" prompt (unchanged)
//   B'. location unknown, 1 site        -> explicit "Use <site>" button,
//       NEVER auto-selected just because it's the only one
//   B''. location unknown, 2+ sites     -> existing radiogroup, unchanged
//   C. location known, 1 matching site  -> shown as already-selected
//      ("Site detected for this order") — auto-selection happens in the
//      parent (SourcingAssistant), this component only reflects it
//   D. location known, 2+ matching      -> radiogroup limited to the
//      matching sites only (never the non-matching ones as primary options)
//   E. location known, 0 matching       -> "No active site matches X" +
//      Create Site link + explicit "use an existing site instead" override
//   F/G. override toggled/selected      -> allSites offered explicitly; a
//      visible warning is shown once a non-matching site is actually selected

type Props = {
  loading: boolean;
  requestedLocation: string | null;
  matchingSites: SiteChoice[];
  allSites: SiteChoice[];
  selectedSiteId: string | null;
  siteSelectionReason: SiteSelectionReason;
  savingSiteId: string | null;
  showOverride: boolean;
  onToggleOverride: () => void;
  onSelect: (siteId: string) => void;
};

function SiteRadioGroup({
  sites,
  selectedSiteId,
  savingSiteId,
  onSelect,
  ariaLabel,
}: {
  sites: SiteChoice[];
  selectedSiteId: string | null;
  savingSiteId: string | null;
  onSelect: (siteId: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label={ariaLabel}>
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
            {savingSiteId === site.id ? <span className="text-xs text-slate-400">Saving…</span> : null}
          </label>
        );
      })}
    </div>
  );
}

export default function SiteStep({
  loading,
  requestedLocation,
  matchingSites,
  allSites,
  selectedSiteId,
  siteSelectionReason,
  savingSiteId,
  showOverride,
  onToggleOverride,
  onSelect,
}: Props) {
  if (loading) return null;

  // State B — no active sites at all, regardless of location.
  if (allSites.length === 0) {
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

  const overrideSite = selectedSiteId ? allSites.find((s) => s.id === selectedSiteId) ?? null : null;
  const overrideWarning =
    siteSelectionReason === "USER_OVERRIDE" && overrideSite && requestedLocation ? (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        ⚠ The requirement mentions <span className="font-semibold">{requestedLocation}</span>, but you
        selected <span className="font-semibold">{overrideSite.name}</span>. This site was chosen by
        you, not detected from the requirement.
      </p>
    ) : null;

  // State B'/B'' — no delivery location could be determined at all. Never
  // silently assume the only active site is the intended destination (§4).
  if (!requestedLocation) {
    if (allSites.length === 1) {
      const only = allSites[0];
      const isSelected = selectedSiteId === only.id;
      return (
        <section className="panel space-y-2 p-4">
          <header className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[color:var(--posh-fg)]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-800">Which site is this order for?</h2>
          </header>
          <p className="text-sm text-slate-700">
            {only.name}
            {only.location ? <span className="text-slate-400"> – {only.location}</span> : null}
          </p>
          <button
            type="button"
            onClick={() => onSelect(only.id)}
            disabled={savingSiteId !== null}
            className="posh-btn-solid inline-flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {isSelected ? "Selected" : savingSiteId === only.id ? "Saving…" : `Use ${only.name}`}
          </button>
        </section>
      );
    }

    return (
      <section className="panel space-y-3 p-4">
        <header className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-[color:var(--posh-fg)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-800">Which site is this order for?</h2>
        </header>
        <SiteRadioGroup
          sites={allSites}
          selectedSiteId={selectedSiteId}
          savingSiteId={savingSiteId}
          onSelect={onSelect}
          ariaLabel="Select the site this order is for"
        />
      </section>
    );
  }

  // From here on, a requestedLocation IS known.

  // State C — exactly one matching site: shown as detected/auto-selected.
  if (matchingSites.length === 1 && siteSelectionReason !== "USER_OVERRIDE") {
    const match = matchingSites[0];
    return (
      <section className="panel space-y-2 p-4">
        <header className="mb-1 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-[color:var(--posh-fg)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-800">Site detected for this order</h2>
        </header>
        <p className="text-sm text-slate-700">
          <span className="font-semibold">{match.name}</span>
          {match.location ? ` – ${match.location}` : ""}
          {savingSiteId === match.id ? " (saving…)" : ""}
        </p>
      </section>
    );
  }

  // State D — multiple matching sites: ask which ONE of the matching sites,
  // never presenting a non-matching site as a primary option.
  if (matchingSites.length > 1 && !showOverride) {
    return (
      <section className="panel space-y-3 p-4">
        <header className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-[color:var(--posh-fg)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-800">
            Which {requestedLocation} site is this order for?
          </h2>
        </header>
        <SiteRadioGroup
          sites={matchingSites}
          selectedSiteId={selectedSiteId}
          savingSiteId={savingSiteId}
          onSelect={onSelect}
          ariaLabel={`Select the ${requestedLocation} site this order is for`}
        />
        {allSites.length > matchingSites.length ? (
          <button
            type="button"
            onClick={onToggleOverride}
            className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
          >
            Use another existing site
          </button>
        ) : null}
      </section>
    );
  }

  // State E — no matching site (or the customer opened the override picker
  // from state D): explain the mismatch, offer site creation, AND let the
  // customer explicitly override with any existing ACTIVE site.
  return (
    <section className="panel space-y-3 p-4">
      {overrideWarning}
      <header className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-[color:var(--posh-fg)]" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-slate-800">
          {matchingSites.length === 0
            ? `No active site matches ${requestedLocation}.`
            : `Which ${requestedLocation} site is this order for?`}
        </h2>
      </header>

      {matchingSites.length === 0 && (
        <>
          <p className="text-sm text-slate-600">
            You don&apos;t currently have an active site for {requestedLocation}. Please create a
            relevant site before proceeding, or use an existing site instead.
          </p>
          <a
            href="/sites"
            className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-[color:var(--posh-primary)] hover:text-[color:var(--posh-fg)]"
          >
            Create New Site
          </a>
        </>
      )}

      {!showOverride ? (
        <button
          type="button"
          onClick={onToggleOverride}
          className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
        >
          {matchingSites.length === 0
            ? "Or use an existing site instead"
            : "Choose a different existing site"}
        </button>
      ) : (
        <>
          <p className="text-xs font-medium text-slate-500">Use an existing site instead:</p>
          <SiteRadioGroup
            sites={allSites}
            selectedSiteId={selectedSiteId}
            savingSiteId={savingSiteId}
            onSelect={onSelect}
            ariaLabel="Choose an existing site to use instead"
          />
          <button
            type="button"
            onClick={onToggleOverride}
            className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
          >
            Back
          </button>
        </>
      )}
    </section>
  );
}


