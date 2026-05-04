const steps = [
  {
    title: "Business Information",
    description: "Legal entity, GSTIN, registered address, and authorized signatory.",
    status: "Completed",
  },
  {
    title: "Plant & Warehouse Details",
    description: "Dispatch cities, monthly capacity, logistics partners.",
    status: "In Progress",
  },
  {
    title: "Banking & Payout",
    description: "Account validation and settlement cycle selection.",
    status: "Pending",
  },
  {
    title: "Quality Compliance",
    description: "BIS / ISO certificates and lab test reports.",
    status: "Pending",
  },
];

export default function SupplierOnboardingPage() {
  return (
    <section className="panel p-5">
      <h3 className="text-2xl font-extrabold text-slate-900">Supplier Onboarding</h3>
      <p className="mt-1 text-sm text-slate-600">Finish setup to list products and receive verified builder purchase orders.</p>

      <div className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <article key={step.title} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900">
                {index + 1}. {step.title}
              </h4>
              <span
                className={`rounded-full px-2 py-1 text-xs font-bold ${
                  step.status === "Completed"
                    ? "bg-emerald-50 text-emerald-700"
                    : step.status === "In Progress"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {step.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{step.description}</p>
          </article>
        ))}
      </div>

      <button className="mt-5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white">Continue Setup</button>
    </section>
  );
}