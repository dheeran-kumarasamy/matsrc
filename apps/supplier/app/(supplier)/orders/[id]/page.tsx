import { OrderStatusActions } from "@/components/supplier/OrderStatusActions";
import { getSupplierOrderDetail } from "@/lib/supplier-data";

type Props = {
  params: { id: string };
};

type TrackingStep = {
  id: string;
  label: string;
};

export default async function SupplierOrderDetailPage({ params }: Props) {
  const order = await getSupplierOrderDetail(params.id);

  if (!order) {
    return <div className="panel p-5 text-sm text-slate-600">Order not found for this supplier.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="panel p-5">
        <h3 className="text-xl font-extrabold text-slate-900">Order #{order.id}</h3>
        <p className="mt-1 text-sm text-slate-600">
          Buyer: {order.buyer} | Material: {order.material} | Delivery: {order.deliveryDate}
        </p>

        <div className="mt-4 space-y-3">
          {order.tracking.map((step: TrackingStep, i) => (
            <div key={step.id} className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${i === order.tracking.length - 1 ? "bg-blue-600" : "bg-slate-300"}`} />
              <p className="text-sm font-semibold text-slate-700">{step.label}</p>
            </div>
          ))}
          {order.tracking.length === 0 ? <p className="text-sm text-slate-500">No tracking events recorded yet.</p> : null}
        </div>
      </section>

      <OrderStatusActions orderId={order.id} status={order.status} />
    </div>
  );
}