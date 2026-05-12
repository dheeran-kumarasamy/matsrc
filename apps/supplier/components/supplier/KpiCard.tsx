import type { ReactNode } from "react";

type KpiCardProps = {
  label: string;
  value: string;
  hint: string;
};

const iconByLabel: Record<string, ReactNode> = {
  "Active Listings": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 9h6M9 13h6M9 17h4" />
    </svg>
  ),
  "Incoming Orders": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="4" y="6" width="16" height="13" rx="2" />
      <path d="M8 6V4h8v2" />
    </svg>
  ),
  "Open RFQs": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M5 6h14v10H9l-4 4V6Z" />
      <path d="M9 10h6M9 13h4" />
    </svg>
  ),
  "Fulfilment Rate": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M6 18 18 6" />
      <circle cx="8" cy="8" r="2" />
      <circle cx="16" cy="16" r="2" />
    </svg>
  ),
};

export function KpiCard({ label, value, hint }: KpiCardProps) {
  const metricType = label === "Fulfilment Rate" ? "Percentage" : "Count";

  return (
    <article className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-extrabold uppercase leading-5 tracking-tight text-slate-800">{label}</p>
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-100 text-cyan-700">{iconByLabel[label]}</span>
      </div>
      <p className="mt-2 text-xl text-slate-700">{metricType}</p>
      <p className="text-5xl font-extrabold leading-none text-slate-900">{value}</p>
      <p className="mt-2 text-lg leading-6 text-slate-700">{hint}</p>
    </article>
  );
}