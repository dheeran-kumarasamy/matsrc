import Link from "next/link";

// UF-10: Dispute list — FR-16
export default async function DisputesPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Disputes</h1>
        <Link href="/disputes/new" className="text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100 transition-colors">
          + Raise Dispute
        </Link>
      </div>
      <div className="panel p-10 text-center">
        <p className="text-slate-400 text-sm">No disputes raised.</p>
      </div>
    </div>
  );
}
