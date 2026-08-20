"use client";

import type { DistrictPricePanelDistrictOption } from "@/lib/district-pricing-types";

// Dropdown for choosing which district's price intelligence to view.
// Persists the last explicit choice in localStorage (keyed per canonical
// product) so returning builders don't have to re-select every visit —
// the *initial* default still comes from the server (builder's project
// district), this only remembers an explicit override.
export function districtSelectorStorageKey(canonicalProductId: string) {
  return `matsrc_district_pricing_selection_${canonicalProductId}`;
}

export default function DistrictSelector({
  options,
  selectedCode,
  onChange,
  isFallback,
}: {
  options: DistrictPricePanelDistrictOption[];
  selectedCode: string | null;
  onChange: (code: string) => void;
  isFallback?: boolean;
}) {
  return (
    <div>
      <label htmlFor="district-pricing-selector" className="block text-xs font-medium text-slate-500">
        District
      </label>
      <select
        id="district-pricing-selector"
        value={selectedCode ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="posh-input mt-1"
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
      {isFallback ? (
        <p className="mt-1 text-xs font-semibold text-[color:var(--posh-fg-muted)]">
          Estimated using nearby verified market data — no data for your project district yet.
        </p>
      ) : null}
    </div>
  );
}
