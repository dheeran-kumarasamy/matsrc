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

const statusColors: Record<string, string> = {
  OPEN: "bg-yellow-100 text-yellow-700",
  UNDER_REVIEW: "bg-blue-100 text-blue-700",
  RESOLVED: "bg-green-100 text-green-700",
  ESCALATED: "bg-red-100 text-red-700",
};

// UF-10: Dispute list — FR-16
export default async function DisputesPage() {
  let disputes: Dispute[] = [];

  try {
    disputes = await builderApiGet<Dispute[]>("/builder/disputes");
  } catch {
    disputes = [];
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Disputes</h1>
        <Link href="/disputes/new" className="text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100 transition-colors">
          + Raise Dispute
        </Link>
      </div>
      {disputes.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="text-slate-400 text-sm">No disputes raised.</p>
        </div>
      ) : (
        <div className="panel divide-y divide-slate-100">
          {disputes.map((d) => (
            <div key={d.id} className="p-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">{d.issueType.replace(/_/g, " ")}</p>
                <p className="text-xs text-slate-500 mt-0.5">Order #{d.orderId.slice(0, 8)} · {new Date(d.createdAt).toLocaleDateString("en-IN")}</p>
                <p className="text-xs text-slate-600 mt-1 line-clamp-2">{d.description}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusColors[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                {d.status.replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
