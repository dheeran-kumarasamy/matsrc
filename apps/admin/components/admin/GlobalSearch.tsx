"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiGet } from "@/lib/api-client";
import type { PricingGlobalSearchResult } from "@/lib/pricing-admin-types";

const EMPTY_RESULT: PricingGlobalSearchResult = {
  districts: [],
  categories: [],
  skus: [],
  aliases: [],
  sources: [],
  anomalies: [],
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PricingGlobalSearchResult>(EMPTY_RESULT);

  async function runSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResult(EMPTY_RESULT);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await adminApiGet<PricingGlobalSearchResult>(
        `/admin/pricing/search?q=${encodeURIComponent(q.trim())}`
      );
      setResult(data);
    } catch {
      setError("Search is unavailable right now. Please try again.");
      setResult(EMPTY_RESULT);
    } finally {
      setLoading(false);
    }
  }

  const totalResults =
    result.districts.length +
    result.categories.length +
    result.skus.length +
    result.aliases.length +
    result.sources.length +
    result.anomalies.length;

  return (
    <div className="relative">
      <input
        type="search"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => void runSearch(e.target.value)}
        placeholder="Search districts, SKUs, sources, anomalies..."
        aria-label="Global admin search"
        className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      {open && query.trim().length >= 2 ? (
        <div
          role="listbox"
          className="absolute z-20 mt-1 w-96 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          {loading ? (
            <p className="text-sm text-slate-500">Searching…</p>
          ) : error ? (
            <p role="alert" className="text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : totalResults === 0 ? (
            <p className="text-sm text-slate-500">No matches for "{query}".</p>
          ) : (
            <div className="space-y-3 text-sm">
              {result.districts.length > 0 ? (
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">Districts</p>
                  {result.districts.map((d) => (
                    <p key={d.id} className="py-0.5">
                      {d.name} ({d.code})
                    </p>
                  ))}
                </div>
              ) : null}
              {result.categories.length > 0 ? (
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">Categories</p>
                  {result.categories.map((c) => (
                    <p key={c.id} className="py-0.5">
                      {c.name} ({c.code})
                    </p>
                  ))}
                </div>
              ) : null}
              {result.skus.length > 0 ? (
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">Canonical SKUs</p>
                  {result.skus.map((s) => (
                    <p key={s.id} className="py-0.5">
                      {s.code}
                    </p>
                  ))}
                </div>
              ) : null}
              {result.aliases.length > 0 ? (
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">Aliases</p>
                  {result.aliases.map((a) => (
                    <p key={a.id} className="py-0.5">
                      {a.rawLabel} {a.canonicalSkuId ? "" : "(unmapped)"}
                    </p>
                  ))}
                </div>
              ) : null}
              {result.sources.length > 0 ? (
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">Sources</p>
                  {result.sources.map((s) => (
                    <p key={s.id} className="py-0.5">
                      {s.name} ({s.code})
                    </p>
                  ))}
                </div>
              ) : null}
              {result.anomalies.length > 0 ? (
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">Anomalies</p>
                  {result.anomalies.map((a) => (
                    <p key={a.id} className="py-0.5">
                      {a.reason} — {a.detail ?? "no detail"}
                    </p>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  router.push("/pricing");
                  setOpen(false);
                }}
                className="text-xs font-semibold text-emerald-700 underline"
              >
                Open Pricing Intelligence for full detail
              </button>
            </div>
          )}
        </div>
      ) : null}
      {open ? (
        <button
          type="button"
          aria-label="Close search results"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-10 cursor-default"
          tabIndex={-1}
        />
      ) : null}
    </div>
  );
}
