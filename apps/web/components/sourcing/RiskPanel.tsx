"use client";

import { AlertTriangle, Info, XCircle } from "lucide-react";

// Phase 8 — Risk and data-gap disclosure panel.
// Only risks that are grounded in actual data are shown.
// Never fabricates risks.

export type SourcingRiskView = {
  code: string;
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
};

type Props = {
  risks: SourcingRiskView[];
  dataGaps: string[];
};

const DATA_GAP_LABELS: Record<string, string> = {
  noHistoricalData: "No historical price data available",
  stalePriceData: "Price data may be outdated",
  fewObservations: "Very few price observations",
  insufficientTrendData: "Insufficient data for trend analysis",
  fewTrendPoints: "Limited historical points for trend",
  noBaseOptions: "No supplier options to compare",
};

function SeverityIcon({ severity }: { severity: "INFO" | "WARNING" | "CRITICAL" }) {
  if (severity === "CRITICAL") return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--posh-primary-fg)]" />;
  if (severity === "WARNING") return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--posh-fg)]" />;
  return <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--posh-fg)]" />;
}

// Severity is expressed with contrast and weight, not colour: CRITICAL is a
// solid black block, WARNING an outlined block, INFO a plain tinted block.
function severityBg(severity: "INFO" | "WARNING" | "CRITICAL"): string {
  if (severity === "CRITICAL") return "bg-[color:var(--posh-primary)] font-semibold text-[color:var(--posh-primary-fg)]";
  if (severity === "WARNING") return "border border-[color:var(--posh-primary)] bg-[color:var(--posh-bg-card)] font-semibold text-[color:var(--posh-fg)]";
  return "bg-[rgba(var(--posh-wash-rgb),0.04)] text-[color:var(--posh-fg)]";
}

export default function RiskPanel({ risks, dataGaps }: Props) {
  const unknownGaps = dataGaps.filter((gap) => !risks.some((r) => r.code.toLowerCase().includes(gap)));
  const hasContent = risks.length > 0 || unknownGaps.length > 0;
  if (!hasContent) return null;

  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Risks & Data Gaps</h2>

      <div className="space-y-2">
        {risks.map((risk) => (
          <div
            key={risk.code}
            className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${severityBg(risk.severity)}`}
          >
            <SeverityIcon severity={risk.severity} />
            <span>{risk.message}</span>
          </div>
        ))}

        {unknownGaps
          .filter((gap) => DATA_GAP_LABELS[gap])
          .map((gap) => (
            <div key={gap} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>{DATA_GAP_LABELS[gap]}</span>
            </div>
          ))}
      </div>
    </section>
  );
}
