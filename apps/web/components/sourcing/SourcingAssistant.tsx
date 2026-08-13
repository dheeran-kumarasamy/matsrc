"use client";

import { useCallback, useState } from "react";
import { Send, Sparkles } from "lucide-react";

import { ApiError, builderApiGet, builderApiPost } from "@/lib/api";

import ApprovalBar from "./ApprovalBar";
import ProductMatchCard from "./ProductMatchCard";
import RecommendationCard from "./RecommendationCard";
import RequirementCard from "./RequirementCard";
import SourcingProgressRail from "./SourcingProgressRail";
import SupplierComparisonTable from "./SupplierComparisonTable";
import type {
  ProductMatchView,
  RequirementView,
  SessionResponse,
  SourcingStage,
  StoredRecommendationView,
  TurnResponse,
} from "./types";

// The AI Sourcing Assistant surface.
//
// POSITIONING (§28): this is deliberately NOT a chat window. The customer types
// what they need once, and the interface then shows the sourcing WORK —
// requirement understood, products found, suppliers found, costs compared,
// recommendation, approval. The transcript is secondary to the structured cards.
//
// Customer-facing copy never says "AI employee".

const EXAMPLES = [
  "500 bags PPC cement to Erode",
  "20 tonnes 12mm TMT steel to Salem",
  "10,000 AAC blocks near Coimbatore",
];

type Props = {
  /** Existing session to resume, when the customer returns to one. */
  initialSession?: SessionResponse | null;
};

export default function SourcingAssistant({ initialSession = null }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(initialSession?.id ?? null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stage, setStage] = useState<SourcingStage | null>(
    initialSession
      ? initialSession.recommendations.length > 0
        ? "RECOMMENDED"
        : "COLLECTING"
      : null
  );
  const [requirement, setRequirement] = useState<RequirementView | null>(
    initialSession?.requirement ?? null
  );
  const [assistantMessage, setAssistantMessage] = useState<string | null>(
    initialSession?.conversation.filter((turn) => turn.role === "assistant").slice(-1)[0]?.content ??
      null
  );
  const [matches, setMatches] = useState<ProductMatchView[]>(initialSession?.candidateProducts ?? []);
  const [alternatives, setAlternatives] = useState<ProductMatchView[]>([]);
  const [supplierCount, setSupplierCount] = useState(initialSession?.candidateSuppliers.length ?? 0);
  const [recommendations, setRecommendations] = useState<StoredRecommendationView[]>(
    initialSession?.recommendations ?? []
  );
  const [headline, setHeadline] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSession?.recommendations[0]?.id ?? null
  );
  const [confirmedMessage, setConfirmedMessage] = useState<string | null>(
    initialSession?.confirmedAt ? "This sourcing request has already been confirmed." : null
  );
  const [showAllOptions, setShowAllOptions] = useState(false);

  /** Reloads the persisted session so the UI has the stored recommendation ids. */
  const refreshSession = useCallback(async (id: string) => {
    const session = await builderApiGet<SessionResponse>(`/sourcing/sessions/${id}`);
    setRecommendations(session.recommendations);
    setSelectedId((current) => current ?? session.recommendations[0]?.id ?? null);
  }, []);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const created = await builderApiPost<{ id: string }>("/sourcing/sessions", {});
    setSessionId(created.id);
    return created.id;
  }

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);

    try {
      const id = await ensureSession();
      const result = await builderApiPost<TurnResponse>(`/sourcing/sessions/${id}/message`, {
        message: trimmed,
      });

      setStage(result.stage);
      setRequirement(result.requirement);
      setAssistantMessage(result.message);
      setMatches(result.productMatches);
      setAlternatives(result.productAlternatives);
      setSupplierCount(result.suppliers.length);
      setHeadline(result.headline);
      setInput("");
      setShowAllOptions(false);

      // Recommendations carry DB ids (needed for approval), so re-read them.
      if (result.options.length > 0) {
        setSelectedId(null);
        await refreshSession(id);
      } else {
        setRecommendations([]);
        setSelectedId(null);
      }
    } catch (caught) {
      // §24: show a normal application-level error, never provider internals.
      setError(
        caught instanceof ApiError && caught.status === 429
          ? "You're sending requests too quickly. Please wait a moment and try again."
          : "I couldn't complete that sourcing request. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  async function proceed() {
    if (!sessionId || !selectedId || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await builderApiPost<{ message: string; supplierName?: string }>(
        `/sourcing/sessions/${sessionId}/confirm`,
        { recommendationId: selectedId }
      );
      setConfirmedMessage(
        result.supplierName
          ? `Enquiry submitted to ${result.supplierName}. You can track it under My Orders.`
          : result.message
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "I couldn't submit that request. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const selected = recommendations.find((row) => row.id === selectedId) ?? null;
  const otherPriced = recommendations.filter(
    (row) => row.id !== selected?.id && row.unitLandedCost !== null
  );
  const alternativeRange =
    otherPriced.length > 0
      ? {
          min: Math.min(...otherPriced.map((row) => row.unitLandedCost as number)),
          max: Math.max(...otherPriced.map((row) => row.unitLandedCost as number)),
        }
      : null;

  const requirementComplete = Boolean(
    requirement?.material && requirement?.quantity && requirement?.unit && requirement?.location
  );

  return (
    <div className="space-y-4">
      <Composer input={input} setInput={setInput} busy={busy} started={Boolean(stage)} onSend={send} />

      {error && (
        <p className="panel border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {stage && (
        <>
          <div className="panel p-4">
            <SourcingProgressRail
              stage={stage}
              requirementComplete={requirementComplete}
              productCount={matches.length}
              supplierCount={supplierCount}
              optionCount={recommendations.length}
            />
          </div>

          {assistantMessage && (
            <div className="panel p-4">
              <p className="whitespace-pre-line text-sm text-slate-700">{assistantMessage}</p>
            </div>
          )}

          {requirement && <RequirementCard requirement={requirement} />}

          <ProductMatchCard matches={matches} alternatives={alternatives} />

          {selected && !confirmedMessage && (
            <RecommendationCard
              headline={headline}
              recommendation={selected}
              alternativeCount={otherPriced.length}
              alternativeRange={alternativeRange}
              unit={selected.unit}
            />
          )}

          {/* The full comparison is shown by default when nothing is selected
              yet, and on demand via "View alternatives". */}
          {(showAllOptions || !selected) && !confirmedMessage && (
            <SupplierComparisonTable
              recommendations={recommendations}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}

          {selected && !confirmedMessage && (
            <ApprovalBar
              recommendation={selected}
              submitting={submitting}
              onProceed={proceed}
              onViewAlternatives={() => setShowAllOptions(true)}
              onCancel={() => setSelectedId(null)}
            />
          )}

          {confirmedMessage && (
            <p className="panel border-green-200 bg-green-50 p-4 text-sm text-green-800">
              {confirmedMessage}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** The single input. Shown large on first load, compact once work has started. */
function Composer({
  input,
  setInput,
  busy,
  started,
  onSend,
}: {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  started: boolean;
  onSend: (message: string) => void;
}) {
  return (
    <section className="panel p-4">
      {!started && (
        <>
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" aria-hidden="true" />
            <h1 className="text-base font-semibold text-slate-900">
              What material are you looking for?
            </h1>
          </div>
          <p className="mb-3 text-sm text-slate-500">
            Tell us what you need and the AI Sourcing Assistant will help you find the best sourcing
            option.
          </p>
        </>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSend(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Describe what you need..."
          maxLength={1000}
          disabled={busy}
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm transition-colors focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
          aria-label="Describe the material you need"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {busy ? "Working…" : "Send"}
        </button>
      </form>

      {!started && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-slate-400">Examples:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onSend(example)}
                disabled={busy}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
