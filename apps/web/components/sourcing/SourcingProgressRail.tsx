"use client";

import { Check } from "lucide-react";

import type { SourcingStage } from "./types";

// §15's conversation-state rail:
//   Customer requirement -> Products found -> Suppliers found -> Price
//   comparison -> Recommendation
//
// This is the element that makes the feature feel like a delegated procurement
// task rather than a chat window (§28): the customer can always see which stage
// of the sourcing job the assistant has reached.

const STEPS = [
  { key: "requirement", label: "Requirement" },
  { key: "products", label: "Products" },
  { key: "suppliers", label: "Suppliers" },
  { key: "comparison", label: "Comparison" },
  { key: "recommendation", label: "Recommendation" },
] as const;

type Props = {
  stage: SourcingStage | null;
  requirementComplete: boolean;
  productCount: number;
  supplierCount: number;
  optionCount: number;
};

/**
 * Derives how many steps are complete from what actually happened — never from
 * an optimistic guess. A stage that failed (no product / no supplier) stops the
 * rail there, so the UI cannot imply progress the backend didn't make.
 */
function completedCount(props: Props): number {
  let count = 0;
  if (props.requirementComplete) count = 1;
  if (props.productCount > 0) count = 2;
  if (props.supplierCount > 0) count = 3;
  if (props.optionCount > 0) count = 4;
  if (props.stage === "RECOMMENDED" && props.optionCount > 0) count = 5;
  return count;
}

export default function SourcingProgressRail(props: Props) {
  const completed = completedCount(props);

  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Sourcing progress">
      {STEPS.map((step, index) => {
        const isDone = index < completed;
        const isCurrent = index === completed;

        return (
          <li key={step.key} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isDone
                  ? "bg-[rgba(240,232,216,0.04)] text-[color:var(--posh-fg)]"
                  : isCurrent
                    ? "bg-slate-100 text-slate-700"
                    : "bg-slate-50 text-slate-400"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  isDone ? "bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)]" : "bg-[rgba(240,232,216,0.10)] text-[color:var(--posh-primary-fg)]"
                }`}
                aria-hidden="true"
              >
                {isDone ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {step.label}
            </div>
            {index < STEPS.length - 1 && (
              <span className="hidden h-px w-4 bg-slate-200 sm:block" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
