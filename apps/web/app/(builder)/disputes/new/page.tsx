"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// UF-10 Step 3: Raise dispute ticket — FR-16
function NewDisputeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId") ?? "";
  const [issueType, setIssueType] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const issueTypes = ["Wrong quantity delivered", "Damaged goods", "Quality mismatch", "Late delivery", "Missing items", "Other"];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const form = new FormData();
      form.append("orderId", orderId);
      form.append("issueType", issueType);
      form.append("description", description);
      files.forEach((f) => form.append("evidence", f));
      const res = await fetch("/api/disputes", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).message);
      router.push("/disputes");
    } catch (err: any) {
      setError(err.message ?? "Failed to raise dispute");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Raise a Dispute</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700">
        Disputes are reviewed within <strong>72 hours</strong>. Unresolved tickets escalate automatically to senior admin. (FR-16)
      </div>

      <form onSubmit={handleSubmit} className="panel p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1.5 block">Order ID</label>
          <input value={orderId} readOnly className="w-full border border-slate-100 bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-500" />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 mb-1.5 block">Issue Type</label>
          <select value={issueType} onChange={(e) => setIssueType(e.target.value)} required className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700">
            <option value="">Select issue type</option>
            {issueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 mb-1.5 block">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={4}
            placeholder="Describe the issue in detail..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700 resize-none"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 mb-1.5 block">Photo Evidence</label>
          <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center">
            <input
              type="file"
              accept="image/*"
              multiple
              id="evidence"
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <label htmlFor="evidence" className="cursor-pointer text-sm text-blue-700 hover:underline">
              {files.length > 0 ? `${files.length} file(s) selected` : "Upload photos (JPG / PNG)"}
            </label>
          </div>
        </div>

        {error && <p className="text-red-500 text-xs">{error}</p>}

        <button type="submit" disabled={loading} className="w-full bg-red-500 hover:bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
          {loading ? "Submitting..." : "Submit Dispute"}
        </button>
      </form>
    </div>
  );
}

export default function NewDisputePage() {
  return (
    <Suspense fallback={<div className="panel p-8 text-center text-slate-500 text-sm">Loading...</div>}>
      <NewDisputeForm />
    </Suspense>
  );
}
