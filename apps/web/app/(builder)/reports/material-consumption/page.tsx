// Posh Material Consumption Report — standalone page.
// Renders the new two-pane console (left report-nav sidebar + embedded report
// panel) at /reports/material-consumption, inside the existing builder layout
// (so the sticky header, cart, notifications and BuilderNav all remain in place).
//
// The existing /reports page and its modal overlay are NOT touched.
import PoshMaterialConsumptionConsole from "@/components/reports/PoshMaterialConsumptionConsole";

export default function MaterialConsumptionReportPage() {
  return <PoshMaterialConsumptionConsole />;
}
