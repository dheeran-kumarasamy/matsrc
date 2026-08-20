import Link from "next/link";
import { builderApiGet } from "@/lib/api";

type Dispute = {
  id: string;
  orderId: string;
  issueType: string;
  description: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "ESCALATED";
  createdAt: string;
};

// Monochrome status treatment — escalated/resolved read as solid black so
// they still stand out without introducing colour into the palette.
const statusColors: Record<string, string> = {
  OPEN: "posh-status",
  UNDER_REVIEW: "posh-status",
  RESOLVED: "posh-status-strong",
  ESCALATED: "posh-status-strong",
};

// UF-10: Dispute list — FR-16
export default async function DisputesPage() {
  let disputes: Dispute[] = [];

  try {
    disputes = await builderApiGet<Dispute[]>("/disputes");
  } catch {
    disputes = [];
  }

  return (
    <div className="posh-body space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="posh-eyebrow">Resolution desk</p>
          <h1 className="posh-page-title mt-2">Disputes</h1>
          <p className="posh-subtitle mt-2 max-w-2xl">
            Raise and track issues on delivered orders — quality, quantity, damage or billing.
          </p>
        </div>
        <Link href="/disputes/new" className="posh-btn">
          + Raise Dispute
        </Link>
      </header>

      {disputes.length === 0 ? (
        <div className="posh-card p-10 text-center">
          <p className="posh-card-title">No disputes raised</p>
          <p className="posh-muted mt-2 text-xs">Everything you have ordered has been accepted as delivered.</p>
        </div>
      ) : (
        <div className="posh-card divide-y divide-[color:var(--posh-border)]">
          {disputes.map((d) => (
            <div key={d.id} className="flex items-start justify-between gap-4 p-5">
              <div>
                <p className="text-base font-bold tracking-tight text-[color:var(--posh-fg)]">{d.issueType.replace(/_/g, " ")}</p>
                <p className="posh-label mt-1">
                  Order #{d.orderId.slice(0, 8)} · {new Date(d.createdAt).toLocaleDateString("en-IN")}
                </p>
                <p className="mt-2 line-clamp-2 text-sm font-medium text-[color:var(--posh-fg-muted)]">{d.description}</p>
              </div>
              <span className={`whitespace-nowrap ${statusColors[d.status] ?? "posh-status"}`}>
                {d.status.replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
