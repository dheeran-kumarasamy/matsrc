import { OrderDetailButton } from "@/components/supplier/OrderDetailButton";

type SupplierOrder = {
  id: string;
  material: string;
  quantity: string;
  eta: string;
  status: "NEW" | "PACKING" | "IN_TRANSIT";
};

const badgeStyles: Record<SupplierOrder["status"], string> = {
  NEW: "bg-amber-100 text-amber-800",
  PACKING: "bg-sky-100 text-sky-800",
  IN_TRANSIT: "bg-emerald-100 text-emerald-800",
};

const badgeLabel: Record<SupplierOrder["status"], string> = {
  NEW: "Pending",
  PACKING: "Processing",
  IN_TRANSIT: "Shipped",
};

function formatOrderId(id: string) {
  const token = id.replace(/[^a-zA-Z0-9]/g, "").slice(-3).toUpperCase() || "000";
  return `ORD-${token}`;
}

export function OrderQueueTable({ orders }: { orders: SupplierOrder[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-7 py-5">
        <h3 className="text-4xl font-extrabold text-slate-900">Incoming Order Queue</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xl">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              <th className="px-7 py-4 font-bold">Order</th>
              <th className="px-7 py-4 font-bold">Material</th>
              <th className="px-7 py-4 font-bold">Quantity</th>
              <th className="px-7 py-4 font-bold">ETA</th>
              <th className="px-7 py-4 font-bold">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-slate-100">
                <td className="px-7 py-5 text-slate-800">
                  {/* Clicking the order number opens the details overlay (UF-04). */}
                  <OrderDetailButton
                    orderId={order.id}
                    label={formatOrderId(order.id)}
                    className="font-semibold text-blue-700 underline decoration-dotted hover:text-blue-900"
                  />
                </td>
                <td className="px-7 py-5 text-slate-800">{order.material}</td>
                <td className="px-7 py-5 text-slate-800">{order.quantity}</td>
                <td className="px-7 py-5 text-slate-800">{order.eta}</td>
                <td className="px-7 py-5">
                  <span className={`rounded-full px-4 py-1 text-base font-semibold ${badgeStyles[order.status]}`}>
                    {badgeLabel[order.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
