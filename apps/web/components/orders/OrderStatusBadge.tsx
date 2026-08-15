type Status = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

// Monochrome status treatment (site-wide black & white palette). Progression
// is expressed with contrast rather than hue: early states are faint chips,
// in-transit states are outlined, and terminal states are solid black.
const colours: Record<Status, string> = {
  PLACED: "bg-black/[0.04] text-black/60 border-black/15",
  PROCESSING: "bg-white text-black border-black/25",
  DISPATCHED: "bg-white text-black border-black/50",
  OUT_FOR_DELIVERY: "bg-white text-black border-black",
  DELIVERED: "bg-black text-white border-black",
  CANCELLED: "bg-white text-black/50 border-black/20 line-through",
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
