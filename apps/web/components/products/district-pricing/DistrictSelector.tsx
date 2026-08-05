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
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
      {isFallback ? (
        <p className="mt-1 text-xs text-amber-600">
          Estimated using nearby verified market data — no data for your project district yet.
        </p>
      ) : null}
    </div>
  );
}
