type Dispute = {
  id: string;
  orderId: string;
  issue: string;
  owner: string;
  sla: string;
  severity: "MEDIUM" | "HIGH";
};

export function DisputeBoard({ disputes }: { disputes: Dispute[] }) {
  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Open Disputes</h3>
      <div className="mt-3 space-y-3">
        {disputes.map((dispute) => (
          <article key={dispute.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">Dispute #{dispute.id}</p>
                <p className="text-sm text-slate-600">Order #{dispute.orderId} · {dispute.issue}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${dispute.severity === "HIGH" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                {dispute.severity}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
              <span>Owner: {dispute.owner}</span>
              <span>SLA: {dispute.sla}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}