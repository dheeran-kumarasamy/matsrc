"use client";

import { useState } from "react";
import { builderApiPost } from "@/lib/api";

type Props = {
  orderId: string;
};

export default function OrderRatingForm({ orderId }: Props) {
  const [deliveryRating, setDeliveryRating] = useState(5);
  const [qualityRating, setQualityRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      await builderApiPost(`/orders/${orderId}/rating`, {
        deliveryRating,
        qualityRating,
        comment: comment.trim() || undefined,
      });
      setSaved(true);
    } catch {
      setError("Unable to save rating right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel p-5 space-y-3">
      <h2 className="text-lg font-semibold text-slate-800">Rate supplier delivery and quality</h2>
      <p className="text-sm text-slate-500">Submit feedback for this delivered order. You can edit within 72 hours.</p>

      <label className="block text-sm text-slate-700">
        Delivery rating
        <select
          value={deliveryRating}
          onChange={(event) => setDeliveryRating(Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
        >
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-slate-700">
        Product quality rating
        <select
          value={qualityRating}
          onChange={(event) => setQualityRating(Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
        >
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-slate-700">
        Comment (optional)
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          placeholder="How was delivery and product quality?"
        />
      </label>

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={loading || saved}
        className="w-full rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {saved ? "Rating saved" : loading ? "Saving..." : "Submit rating"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
