"use client";

import { Package } from "lucide-react";

import type { RequirementView } from "./types";

// Structured "what I understood" card (§15: use structured cards rather than
// plain chat). Showing the extracted requirement back to the customer is also
// the honesty mechanism for derived values — a date inferred from "next week" is
// labelled as derived so the customer can correct it.

type Props = { requirement: RequirementView };

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`text-sm ${value ? "text-slate-800" : "text-slate-400"}`}>
        {value ?? "Not specified"}
      </dd>
    </div>
  );
}

export default function RequirementCard({ requirement }: Props) {
  const quantityLabel =
    requirement.quantity !== null
      ? `${requirement.quantity.toLocaleString("en-IN")}${requirement.unit ? ` ${requirement.unit}` : ""}`
      : null;

  const dateLabel = requirement.requiredDate
    ? requirement.requiredDateText && requirement.requiredDateText !== requirement.requiredDate
      ? // Disclose that the date was derived from the customer's phrasing.
        `${requirement.requiredDate} (from "${requirement.requiredDateText}")`
      : requirement.requiredDate
    : null;

  const deliveryLabel =
    requirement.deliveryRequired === null
      ? null
      : requirement.deliveryRequired
        ? "Delivery required"
        : "Self pickup";

  return (
    <section className="panel p-4">
      <header className="mb-3 flex items-center gap-2">
        <Package className="h-4 w-4 text-black" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-slate-800">Your requirement</h2>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Field label="Material" value={requirement.material} />
        <Field label="Specification" value={requirement.specification} />
        <Field label="Quantity" value={quantityLabel} />
        <Field label="Delivery to" value={requirement.location} />
        <Field label="Required by" value={dateLabel} />
        <Field label="Brand" value={requirement.brand ?? "No preference"} />
        {deliveryLabel && <Field label="Delivery" value={deliveryLabel} />}
      </dl>

      {requirement.constraints.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Other notes: {requirement.constraints.join("; ")}
        </p>
      )}
    </section>
  );
}
