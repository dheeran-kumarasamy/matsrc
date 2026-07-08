type Status = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

const steps: { status: Status; label: string; desc: string }[] = [
  { status: "PLACED", label: "Enquiry sent", desc: "Waiting for supplier confirmation" },
  { status: "PROCESSING", label: "Confirmed", desc: "Supplier accepted your enquiry" },
  { status: "DISPATCHED", label: "Dispatched", desc: "On the way — GPS tracking active" },
  { status: "OUT_FOR_DELIVERY", label: "Out for Delivery", desc: "Arriving today" },
  { status: "DELIVERED", label: "Delivered", desc: "Order completed" },
];

const order: Record<Status, number> = { PLACED: 0, PROCESSING: 1, DISPATCHED: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 4, CANCELLED: -1 };

type OrderTimelineProps = {
  status: Status;
  isAggregated?: boolean;
  poolLocked?: boolean;
};

export default function OrderTimeline({ status, isAggregated, poolLocked }: OrderTimelineProps) {
  if (status === "CANCELLED") {
    return (
      <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800">
        <p className="font-semibold">Enquiry declined</p>
        <p className="mt-1 text-rose-700">The supplier declined this enquiry before confirmation. You can place a new request with another supplier.</p>
      </div>
    );
  }

  const current = order[status];

  const poolingSteps = isAggregated
    ? [
        { key: "pooling", label: "Pooling", desc: "Waiting for other builders to join and unlock a better price", done: true },
        {
          key: "price-locked",
          label: "Price Locked",
          desc: poolLocked
            ? "Group pool locked — this order now proceeds at the locked price"
            : "Pool will lock once the window closes or the top tier is reached",
          done: Boolean(poolLocked),
        },
      ]
    : [];

  return (
    <div className="relative">
      {poolingSteps.map((step, i) => (
        <div key={step.key} className="flex gap-4 pb-6 last:pb-0 relative">
          <div className={`absolute left-3.5 top-7 bottom-0 w-0.5 ${step.done ? "bg-emerald-600" : "bg-slate-100"}`} />
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold z-10 ${
              step.done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"
            }`}
          >
            {step.done ? "✓" : i + 1}
          </div>
          <div className="pt-0.5">
            <p className={`text-sm font-medium ${step.done ? "text-slate-800" : "text-slate-400"}`}>{step.label}</p>
            <p className="text-xs text-slate-400">{step.desc}</p>
          </div>
        </div>
      ))}

      {steps.map((step, i) => {
        const done = i <= current;
        const active = i === current;
        return (
          <div key={step.status} className="flex gap-4 pb-6 last:pb-0 relative">
            {/* Vertical line */}
            {i < steps.length - 1 && (
              <div className={`absolute left-3.5 top-7 bottom-0 w-0.5 ${done ? "bg-blue-700" : "bg-slate-100"}`} />
            )}
            {/* Dot */}
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold z-10 ${active ? "bg-blue-700 text-white ring-4 ring-blue-100" : done ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-400"}`}>
              {done ? "✓" : i + 1}
            </div>
            <div className="pt-0.5">
              <p className={`text-sm font-medium ${done ? "text-slate-800" : "text-slate-400"}`}>{step.label}</p>
              <p className="text-xs text-slate-400">{step.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
