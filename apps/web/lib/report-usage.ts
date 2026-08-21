"use client";

// Lightweight client-side "frequently used reports" tracker.
//
// There is no backend analytics table for report opens today, so this
// records REAL usage (report id + timestamp, incremented on every actual
// open) in localStorage, scoped to this browser — never fabricated data.
// The dashboard's "Frequently Used Reports" panel reads this to show the
// builder's own most-opened reports, and simply doesn't render the section
// when nothing has been opened yet.

import { REPORT_DEFINITIONS } from "@/lib/reports-definitions";
import type { ReportDefinition } from "@/lib/reports-types";

const STORAGE_KEY = "matsrc_report_usage_v1";

type UsageEntry = { count: number; lastUsedAt: string };
type UsageMap = Record<string, UsageEntry>;

function readUsageMap(): UsageMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as UsageMap) : {};
  } catch {
    return {};
  }
}

function writeUsageMap(map: UsageMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // best-effort; ignore quota/serialization errors
  }
}

// Call whenever a builder actually opens a report (see ReportsExplorer),
// so the dashboard's "Frequently Used Reports" panel reflects real usage.
export function recordReportUsage(reportId: string) {
  if (!reportId || typeof window === "undefined") return;
  const map = readUsageMap();
  const existing = map[reportId];
  map[reportId] = {
    count: (existing?.count ?? 0) + 1,
    lastUsedAt: new Date().toISOString(),
  };
  writeUsageMap(map);
}

export type FrequentReport = ReportDefinition & { count: number; lastUsedAt: string };

// Returns the builder's real most-opened reports (highest open count first,
// most-recently-opened as tiebreaker), resolved against the live report
// catalogue so a removed/renamed report id never surfaces a stale entry.
// Returns an empty array when the builder hasn't opened any report yet —
// callers should skip rendering the section entirely in that case.
export function getFrequentReports(limit = 5): FrequentReport[] {
  const map = readUsageMap();
  const byId = new Map(REPORT_DEFINITIONS.map((r) => [r.id, r] as const));

  return Object.entries(map)
    .map(([id, entry]) => {
      const definition = byId.get(id);
      if (!definition) return null;
      return { ...definition, count: entry.count, lastUsedAt: entry.lastUsedAt };
    })
    .filter((r): r is FrequentReport => r !== null)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
    })
    .slice(0, limit);
}
