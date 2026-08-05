"use client";

// Phase 6B — fires the "supplier_price_intel_dashboard_viewed" analytics
// event once when the dashboard's Market Intelligence section mounts.
// Renders nothing; purely a best-effort, fire-and-forget side effect so it
// can never affect the dashboard's layout or behavior.

import { useEffect } from "react";

export function MarketIntelligenceDashboardViewedTracker() {
  useEffect(() => {
    fetch("/api/supplier/analytics/price-intelligence-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "supplier_price_intel_dashboard_viewed" }),
    }).catch(() => {
      // Best-effort only.
    });
  }, []);

  return null;
}
