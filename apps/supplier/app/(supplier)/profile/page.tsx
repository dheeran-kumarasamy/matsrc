import { KycStatusPanel } from "@/components/supplier/KycStatusPanel";

export default function SupplierProfilePage() {
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="panel p-5">
        <h3 className="text-xl font-extrabold text-slate-900">Company Profile</h3>
        <p className="mt-1 text-sm text-slate-600">Maintain legal, contact, and payout details used for order settlements.</p>

        <form className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm text-slate-700">
            <span>Company Name</span>
            <input defaultValue="Arka Steel Traders" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm text-slate-700">
            <span>GSTIN</span>
            <input defaultValue="33ABCDE1234F1Z8" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm text-slate-700 md:col-span-2">
            <span>Registered Address</span>
            <input defaultValue="No. 14, Industrial Estate, Chennai" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm text-slate-700">
            <span>Primary Contact</span>
            <input defaultValue="+91 90000 11111" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm text-slate-700">
            <span>Settlement Account</span>
            <input defaultValue="XXXXXX9123" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <div className="md:col-span-2">
            <button type="button" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">
              Save Profile
            </button>
          </div>
        </form>
      </section>

      <KycStatusPanel />
    </div>
  );
}