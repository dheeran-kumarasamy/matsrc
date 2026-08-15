"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  ComposedChart,
} from "recharts";
import { builderApiGet, builderApiPost, ApiError } from "@/lib/api";
import WatchlistButton from "@/components/products/WatchlistButton";
import type {
  PriceReportResponse,
  ReportHistoryEntry,
  BestPriceOffer,
} from "@/lib/price-report-types";

// ─────────────────────────────────────────────────────────────────────────
// Builder "pricing desk" report page — assembles all 7 modules described in
// the price-report spec. Deliberately visually distinct from the rest of
// the app (concrete grey / steel blue / charcoal ink / hi-vis yellow — the
// yellow reserved ONLY for the Buy/Hold/Wait signal card) to read as a
// purpose-built pricing surface rather than a generic dashboard.
//
// All data comes from a single aggregated GET
// (/api/builder/products/[canonicalProductId]/report); the manual market-
// insight refresh is a separate rate-limited POST. No client-side call ever
// triggers the live LLM+web-search path directly.
// ─────────────────────────────────────────────────────────────────────────

const money = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;


export default function PriceReportView({ canonicalProductId }: { canonicalProductId: string }) {
  const [data, setData] = useState<PriceReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    builderApiGet<PriceReportResponse>(`/products/${canonicalProductId}/report`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load price report");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalProductId]);

  if (loading) {
    return (
      <div className="rounded-2xl bg-deskBg p-8 text-center text-sm text-deskInk/60">
        Loading price desk…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl bg-deskBg p-8 text-center text-sm text-deskInk/60">
        {error || "Price report is not available for this product right now."}
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl bg-deskBg p-4 sm:p-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-deskSteel">Price Desk</p>
        <h2 className="text-2xl font-bold text-deskInk">{data.title}</h2>
        <p className="text-sm text-deskInk/60">{data.category}</p>
      </header>

      <SignalCard signal={data.signal} />
      <PriceHistoryModule history={data.history} />
      <ForecastModule forecast={data.forecast} />
      <BestPriceModule offers={data.bestPrice} />
      <RegionalModule regional={data.regional} />
      <MarketInsightModule canonicalProductId={canonicalProductId} initial={data.marketInsight} />
      <PriceAlertModule offers={data.bestPrice} />
    </div>
  );
}

// ── Module 1: Buy/Hold/Wait signal ─────────────────────────────────────
function SignalCard({ signal }: { signal: PriceReportResponse["signal"] }) {
  const verdictStyles: Record<string, string> = {
    BUY: "bg-deskYellow text-deskInk",
    WAIT: "bg-deskYellow text-deskInk",
    HOLD: "bg-deskYellow text-deskInk",
  };

  const verdictLabel: Record<string, string> = {
    BUY: "Buy now",
    HOLD: "Hold",
    WAIT: "Wait",
  };

  return (
    <div className={`animate-deskReveal rounded-2xl p-5 shadow-sm ${verdictStyles[signal.verdict]}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] opacity-70">Recommendation</p>
          <p className="mt-1 text-3xl font-extrabold">{verdictLabel[signal.verdict]}</p>
        </div>
        <span className="rounded-full border border-deskInk/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
          {signal.confidence} confidence
        </span>
      </div>
      <ul className="mt-4 space-y-1.5 text-sm">
        {signal.reasons.map((reason, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Module 2: Price history ────────────────────────────────────────────
type RangeKey = "7D" | "30D" | "90D" | "1Y" | "ALL";
const RANGE_DAYS: Record<RangeKey, number | null> = { "7D": 7, "30D": 30, "90D": 90, "1Y": 365, ALL: null };

function PriceHistoryModule({ history }: { history: ReportHistoryEntry[] }) {
  const [range, setRange] = useState<RangeKey>("30D");
  const [view, setView] = useState<"chart" | "table">("chart");

  const filtered = useMemo(() => {
    const days = RANGE_DAYS[range];
    const asc = [...history].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
    if (days === null) return asc;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return asc.filter((p) => new Date(p.recordedAt).getTime() >= cutoff);
  }, [history, range]);

  const chartData = filtered.map((p) => ({
    date: new Date(p.recordedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    price: p.price,
  }));

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-deskInk">Price history</h3>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-full bg-deskBg p-1">
            {(Object.keys(RANGE_DAYS) as RangeKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setRange(key)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  range === key ? "bg-deskSteel text-white" : "text-deskInk/60 hover:text-deskSteel"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-full bg-deskBg p-1">
            <button
              onClick={() => setView("chart")}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${view === "chart" ? "bg-deskSteel text-white" : "text-deskInk/60"}`}
            >
              Chart
            </button>
            <button
              onClick={() => setView("table")}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${view === "table" ? "bg-deskSteel text-white" : "text-deskInk/60"}`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 flex h-[200px] items-center justify-center text-sm text-deskInk/40">
          No price history recorded for this period yet.
        </div>
      ) : view === "chart" ? (
        <div className="mt-4">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#00000010" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#000000" }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: "#000000" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip formatter={(v: number) => [money(v), "Price"]} />
              <Line type="monotone" dataKey="price" stroke="#000000" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-deskInk/40">
                <th className="py-1.5">Date</th>
                <th className="py-1.5">Price</th>
                <th className="py-1.5">Source</th>
                <th className="py-1.5">Region</th>
              </tr>
            </thead>
            <tbody>
              {[...filtered].reverse().map((row) => (
                <tr key={row.id} className="border-t border-deskBg">
                  <td className="py-1.5 text-deskInk/70">
                    {new Date(row.recordedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td className="py-1.5 font-deskMono tabular-nums text-deskInk">{money(row.price)}</td>
                  <td className="py-1.5 text-deskInk/50">{row.source}</td>
                  <td className="py-1.5 text-deskInk/50">{row.region || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Module 3: Price forecast ───────────────────────────────────────────
function ForecastModule({ forecast }: { forecast: PriceReportResponse["forecast"] }) {
  const chartData = forecast.points.map((p) => ({
    date: new Date(p.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    price: p.price,
    band: [p.lower, p.upper],
  }));

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-deskInk">Price forecast</h3>
      <p className="mt-1 text-xs text-deskInk/50">{forecast.method}</p>

      {!forecast.hasEnoughData ? (
        <div className="mt-6 flex h-[160px] items-center justify-center text-sm text-deskInk/40">
          Not enough price history yet to project a forecast.
        </div>
      ) : (
        <div className="mt-4">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#00000010" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#000000" }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: "#000000" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip formatter={(v: number) => [money(v), "Projected"]} />
              <Area dataKey="band" stroke="none" fill="#000000" fillOpacity={0.12} />
              <Line type="monotone" dataKey="price" stroke="#000000" strokeWidth={2} strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

// ── Module 4: Best price finder (landed cost) ──────────────────────────
function BestPriceModule({ offers }: { offers: BestPriceOffer[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (offers.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-deskInk">Best price finder</h3>
        <p className="mt-3 text-sm text-deskInk/40">No active supplier offers found for this product.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-deskInk">Best price finder</h3>
      <p className="mt-1 text-xs text-deskInk/50">
        Ranked by estimated landed cost (base price + indicative delivery + GST). Freight is confirmed at checkout.
      </p>
      <div className="mt-4 space-y-2">
        {offers.map((offer, idx) => {
          const isExpanded = expanded === offer.productId;
          return (
            <div key={offer.productId} className="rounded-xl border border-deskBg">
              <button
                onClick={() => setExpanded(isExpanded ? null : offer.productId)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {idx === 0 ? (
                    <span className="rounded-full bg-deskSteel px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      Lowest
                    </span>
                  ) : null}
                  <div>
                    <p className="text-sm font-medium text-deskInk">{offer.supplierName}</p>
                    <p className="text-xs text-deskInk/50">
                      {offer.brand || "—"} · {offer.unit || "unit"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-deskMono tabular-nums text-sm font-semibold text-deskInk">
                    {money(offer.landedCost.landedCost)}
                  </p>
                  <p className="text-[11px] text-deskInk/40">landed cost</p>
                </div>
              </button>
              {isExpanded ? (
                <div className="border-t border-deskBg px-4 py-3 text-xs text-deskInk/70">
                  <div className="grid grid-cols-2 gap-y-1 sm:grid-cols-4">
                    <span>Base price</span>
                    <span className="font-deskMono tabular-nums">{money(offer.landedCost.basePrice)}</span>
                    <span>Delivery (est.)</span>
                    <span className="font-deskMono tabular-nums">{money(offer.landedCost.estimatedDelivery)}</span>
                    <span>GST ({offer.landedCost.gstRatePercent}%)</span>
                    <span className="font-deskMono tabular-nums">{money(offer.landedCost.gstAmount)}</span>
                    <span>Stock</span>
                    <span className="font-deskMono tabular-nums">{offer.stock ?? "—"}</span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Module 5: Regional price variation ─────────────────────────────────
function RegionalModule({ regional }: { regional: PriceReportResponse["regional"] }) {
  if (!regional.hasEnoughData) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-deskInk">Regional price variation</h3>
        <p className="mt-3 text-sm text-deskInk/40">
          Not enough regional data yet to compare {regional.builderRegion ? `${regional.builderRegion} against other regions` : "regions"}.
        </p>
      </section>
    );
  }

  const maxAvg = Math.max(...regional.regions.map((r) => r.averagePrice), 1);

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-deskInk">Regional price variation</h3>
      <div className="mt-4 space-y-2.5">
        {regional.regions.map((r) => {
          const isBuilder = r.region === regional.builderRegion;
          return (
            <div key={r.region}>
              <div className="flex items-center justify-between text-xs">
                <span className={isBuilder ? "font-semibold text-deskSteel" : "text-deskInk/60"}>
                  {r.region} {isBuilder ? "(your region)" : ""}
                </span>
                <span className="font-deskMono tabular-nums text-deskInk/70">{money(r.averagePrice)}</span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-deskBg">
                <div
                  className={`h-2 rounded-full ${isBuilder ? "bg-deskSteel" : "bg-deskInk/30"}`}
                  style={{ width: `${(r.averagePrice / maxAvg) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Module 6: Live market intelligence ─────────────────────────────────
function MarketInsightModule({
  canonicalProductId,
  initial,
}: {
  canonicalProductId: string;
  initial: PriceReportResponse["marketInsight"];
}) {
  const [insight, setInsight] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setNotice(null);
    try {
      const result = await builderApiPost<{ marketInsight: typeof initial }>(
        `/products/${canonicalProductId}/report/market-insight`,
        {}
      );
      setInsight(result.marketInsight);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setNotice("Please wait a few minutes before refreshing again.");
      } else {
        setNotice("Could not refresh market intelligence right now.");
      }
    } finally {
      setRefreshing(false);
    }
  }

  if (!insight) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-deskInk">Live market intelligence</h3>
        <p className="mt-3 text-sm text-deskInk/40">Market intelligence isn't available for this category/region yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-deskInk">Live market intelligence</h3>
        <div className="flex items-center gap-2 text-xs text-deskInk/40">
          <span>
            Updated {new Date(insight.generatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            {insight.stale ? " (stale)" : ""}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-full border border-deskSteel px-2.5 py-1 font-medium text-deskSteel disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {notice ? <p className="mt-2 text-xs text-amber-600">{notice}</p> : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {insight.drivers.map((d, i) => (
          <div key={i} className="rounded-xl bg-deskBg p-3">
            <p className="text-sm font-medium text-deskInk">{d.title}</p>
            <p className="mt-1 text-xs text-deskInk/60">{d.detail}</p>
          </div>
        ))}
      </div>

      {insight.outlook ? <p className="mt-3 text-sm text-deskInk/70">{insight.outlook}</p> : null}

      {insight.sources.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-deskBg pt-3 text-xs">
          {insight.sources.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-deskBg px-2.5 py-1 text-deskSteel hover:underline"
            >
              {s.name}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ── Module 7: Price alert (reuses existing watchlist/target-price system) ──
function PriceAlertModule({ offers }: { offers: BestPriceOffer[] }) {
  const cheapest = offers[0];
  if (!cheapest) return null;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-deskInk">Price alert</h3>
      <p className="mt-1 text-xs text-deskInk/50">
        Get notified when the price drops below your target — uses your existing watchlist.
      </p>
      <div className="mt-3 max-w-xs">
        <WatchlistButton productId={cheapest.productId} />
      </div>
    </section>
  );
}
