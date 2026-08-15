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
      <div className="rounded-2xl border border-black bg-white p-4 text-sm text-black">
        <p className="font-bold">Enquiry declined</p>
        <p className="mt-1 font-medium text-black/70">The supplier declined this enquiry before confirmation. You can place a new request with another supplier.</p>
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
          {/* Monochrome rail: completed steps are solid black, pending ones a
              faint black wash (site-wide black & white palette). */}
          <div className={`absolute left-3.5 top-7 bottom-0 w-0.5 ${step.done ? "bg-black" : "bg-black/10"}`} />
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold z-10 ${
              step.done ? "bg-black text-white" : "bg-black/[0.06] text-black/40"
            }`}
          >
            {step.done ? "✓" : i + 1}
          </div>
          <div className="pt-0.5">
            <p className={`text-sm font-bold ${step.done ? "text-black" : "text-black/40"}`}>{step.label}</p>
            <p className="text-xs font-medium text-black/45">{step.desc}</p>
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
              <div className={`absolute left-3.5 top-7 bottom-0 w-0.5 ${done ? "bg-black" : "bg-black/10"}`} />
            )}
            {/* Dot */}
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold z-10 ${active ? "bg-black text-white ring-4 ring-black/10" : done ? "bg-black text-white" : "bg-black/[0.06] text-black/40"}`}>
              {done ? "✓" : i + 1}
            </div>
            <div className="pt-0.5">
              <p className={`text-sm font-bold ${done ? "text-black" : "text-black/40"}`}>{step.label}</p>
              <p className="text-xs font-medium text-black/45">{step.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
