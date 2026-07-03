"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function BuilderProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  const [phone, setPhone] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/login");
    }
  }, [status, router]);

  async function handleUpdateContact(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    
    if (!phone?.trim()) {
      setError("Phone number is required");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/builder/update-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          whatsappNumber: whatsappNumber.trim() || null,
          whatsappEnabled,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update contact");
      }

      setSuccess("Contact information updated successfully!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to update contact");
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!session?.user) {
    return null;
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Your Profile</h1>
      <p className="text-sm text-gray-500 mb-6">Manage your contact information and notification preferences</p>

      <form onSubmit={handleUpdateContact} className="space-y-4">
        {/* Name - Read-only */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
          <input
            type="text"
            value={session.user.name || ""}
            disabled
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm bg-gray-50 text-gray-500"
          />
        </div>

        {/* Email - Read-only */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={session.user.email || ""}
            disabled
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm bg-gray-50 text-gray-500"
          />
        </div>

        {/* Phone - Required */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Phone Number <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-500 mb-2">Your primary contact number for order updates</p>
          <input
            type="tel"
            placeholder="+91 98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* WhatsApp Number - Optional */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">WhatsApp Number (Optional)</label>
          <p className="text-xs text-gray-500 mb-2">For WhatsApp notifications. Leave blank to use your phone number.</p>
          <input
            type="tel"
            placeholder="+91 98765 43210"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* WhatsApp Preferences */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={whatsappEnabled}
              onChange={(e) => setWhatsappEnabled(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            <span className="text-xs text-gray-700">
              <strong>Enable WhatsApp Notifications</strong><br/>
              Receive order updates, price alerts, and support messages on WhatsApp
            </span>
          </label>
        </div>

        {/* Messages */}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-100 rounded-lg p-3">
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-brand-600 transition-colors"
        >
          {loading ? "Updating..." : "Update Contact Information"}
        </button>
      </form>
    </div>
  );
}
