"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// UF-01 Step 6–7: Upload KYC documents
export default function KycPage() {
  const router = useRouter();
  const [files, setFiles] = useState<Record<string, File | null>>({
    GST_CERT: null,
    AADHAAR: null,
    TRADE_LICENCE: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const docLabels: Record<string, string> = {
    GST_CERT: "GST Certificate",
    AADHAAR: "Aadhaar Card",
    TRADE_LICENCE: "Trade Licence",
  };

  function handleFile(type: string, file: File | null) {
    setFiles((prev) => ({ ...prev, [type]: file }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const form = new FormData();
      Object.entries(files).forEach(([type, file]) => {
        if (file) form.append(type, file);
      });
      const res = await fetch("/api/kyc/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).message);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  const allUploaded = Object.values(files).every(Boolean);

  return (
    <>
      <h2 className="text-xl font-semibold text-gray-800 mb-1">KYC Verification</h2>
      <p className="text-sm text-gray-500 mb-6">Upload your business documents to get verified.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {Object.entries(docLabels).map(([type, label]) => (
          <div key={type}>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
            <div className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${files[type] ? "border-green-400 bg-green-50" : "border-gray-200 hover:border-brand-500"}`}>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                id={`file-${type}`}
                onChange={(e) => handleFile(type, e.target.files?.[0] ?? null)}
              />
              <label htmlFor={`file-${type}`} className="cursor-pointer">
                {files[type] ? (
                  <span className="text-green-600 text-sm font-medium">✓ {files[type]!.name}</span>
                ) : (
                  <span className="text-gray-400 text-sm">Click to upload PDF / JPG / PNG</span>
                )}
              </label>
            </div>
          </div>
        ))}

        {error && <p className="text-red-500 text-xs">{error}</p>}

        <button
          type="submit"
          disabled={loading || !allUploaded}
          className="w-full bg-brand-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {loading ? "Uploading..." : "Submit for Verification"}
        </button>

        <p className="text-xs text-gray-400 text-center">
          Documents are verified within 24 hours. You will receive an email & SMS confirmation.
        </p>
      </form>
    </>
  );
}
