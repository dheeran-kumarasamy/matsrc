"use client";

import axios from "axios";
import { useState } from "react";
import { DetailModal } from "@/components/supplier/DetailModal";

type ListingDetail = {
  id: string;
  title: string;
  category: string;
  grade: string;
  unit: string;
  maxServiceableQty: string;
  price: string;
  brand: string;
  description: string;
  pricingTiers: Array<{ minQty: string; maxQty: string; price: string }>;
  aggregationEnabled: boolean;
  images: string[];
};

// "View" trigger for Product/Listing rows on the supplier dashboard — opens details in an
// overlay instead of navigating away, matching the Orders/Enquiries overlay pattern.
export function ListingDetailButton({
  listingId,
  label = "View",
  className = "rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50",
}: {
  listingId: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ListingDetail | null>(null);

  async function openModal() {
    setOpen(true);
    if (detail) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get<ListingDetail>(`/api/supplier/listings/${listingId}`);
      setDetail(data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load product details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        {label}
      </button>

      <DetailModal open={open} onClose={() => setOpen(false)} title={detail ? detail.title : "Product Details"}>
        {loading ? <p className="text-sm text-slate-500">Loading product details...</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {detail ? (
          <div className="space-y-4">
            {detail.images.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto">
                {detail.images.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src} src={src} alt={detail.title} className="h-24 w-24 rounded-lg object-cover" />
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Category</p>
                <p className="text-slate-800">{detail.category}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Grade</p>
                <p className="text-slate-800">{detail.grade || "NA"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Brand</p>
                <p className="text-slate-800">{detail.brand || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Unit</p>
                <p className="text-slate-800">{detail.unit}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Base Price</p>
                <p className="text-slate-800">INR {Number(detail.price).toLocaleString("en-IN")}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Max Serviceable Qty</p>
                <p className="text-slate-800">{detail.maxServiceableQty}</p>
              </div>
            </div>

            {detail.description ? (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Description</p>
                <p className="text-sm text-slate-700">{detail.description}</p>
              </div>
            ) : null}

            {detail.pricingTiers.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Pricing Tiers</p>
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Min Qty</th>
                      <th className="px-3 py-2 font-semibold">Max Qty</th>
                      <th className="px-3 py-2 font-semibold">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.pricingTiers.map((tier, index) => (
                      <tr key={index} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-700">{tier.minQty}</td>
                        <td className="px-3 py-2 text-slate-700">{tier.maxQty}</td>
                        <td className="px-3 py-2 text-slate-700">
                          INR {Number(tier.price).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </DetailModal>
    </>
  );
}
