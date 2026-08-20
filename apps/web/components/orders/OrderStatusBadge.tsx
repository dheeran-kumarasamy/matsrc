type Status = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

// Monochrome status treatment (site-wide black & white palette). Progression
// is expressed with contrast rather than hue: early states are faint chips,
// in-transit states are outlined, and terminal states are solid black.
const colours: Record<Status, string> = {
  PLACED: "bg-[rgba(var(--posh-wash-rgb),0.04)] text-[color:var(--posh-fg-muted)] border-[color:var(--posh-border)]",
  PROCESSING: "bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)] border-[color:var(--posh-border)]",
  DISPATCHED: "bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)] border-[color:var(--posh-border)]",
  OUT_FOR_DELIVERY: "bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg)] border-[color:var(--posh-primary)]",
  DELIVERED: "bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)] border-[color:var(--posh-primary)]",
  CANCELLED: "bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg-muted)] border-[color:var(--posh-border)] line-through",
};

const labels: Record<Status, string> = {
  PLACED: "Enquiry",
  PROCESSING: "Processing",
  DISPATCHED: "Dispatched",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export default function OrderStatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${colours[status]}`}
    >
      {labels[status]}
    </span>
  );
}
