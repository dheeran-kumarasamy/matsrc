type Status = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

const steps: { status: Status; label: string; desc: string }[] = [
  { status: "PLACED", label: "Order Placed", desc: "Your order has been confirmed" },
  { status: "PROCESSING", label: "Processing", desc: "Supplier accepted your order" },
  { status: "DISPATCHED", label: "Dispatched", desc: "On the way — GPS tracking active" },
  { status: "OUT_FOR_DELIVERY", label: "Out for Delivery", desc: "Arriving today" },
  { status: "DELIVERED", label: "Delivered", desc: "Order completed" },
];

const order: Record<Status, number> = { PLACED: 0, PROCESSING: 1, DISPATCHED: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 4, CANCELLED: -1 };

export default function OrderTimeline({ status }: { status: Status }) {
  const current = order[status];

  return (
    <div className="relative">
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
