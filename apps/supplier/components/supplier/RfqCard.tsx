import Link from "next/link";

type Rfq = {
  id: string;
  material: string;
  quantity: string;
  pincode: string;
  dueBy: string;
};

export function RfqCard({ rfq }: { rfq: Rfq }) {
  return (
    <article className="panel p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">RFQ #{rfq.id}</p>
      <h3 className="mt-2 text-lg font-extrabold text-slate-900">{rfq.material}</h3>
      <p className="mt-1 text-sm text-slate-700">Qty: {rfq.quantity}</p>
      <p className="text-sm text-slate-700">Delivery PIN: {rfq.pincode}</p>
      <p className="text-sm text-slate-500">Bid due: {rfq.dueBy}</p>
      <Link href={`/rfqs?respond=${rfq.id}`} className="mt-4 inline-flex rounded-lg bg-orange-500 px-3 py-2 text-sm font-bold text-white">
        Respond with Quote
      </Link>
    </article>
  );
}