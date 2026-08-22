"use client";

import { useCallback, useState } from "react";
import { RotateCcw, Send, Sparkles } from "lucide-react";

import { ApiError, builderApiGet, builderApiPost } from "@/lib/api";

import ApprovalBar from "./ApprovalBar";
import PriceHistoryChart from "./PriceHistoryChart";
import PriceIntelligenceCard from "./PriceIntelligenceCard";
import ProductMatchCard from "./ProductMatchCard";
import RecommendationCard from "./RecommendationCard";
import RequirementCard from "./RequirementCard";
import RiskPanel from "./RiskPanel";
import SourcingProgressRail from "./SourcingProgressRail";
import SupplierComparisonTable from "./SupplierComparisonTable";
import type {
  ProductMatchView,
  RequirementView,
  SessionResponse,
  SourcingDecisionView,
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
  // Phase 8 — sourcing intelligence decision
  const [decision, setDecision] = useState<SourcingDecisionView | null>(null);

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

  /**
   * Clears every piece of client state back to its pre-search default and
   * drops the current session id, so the NEXT `send()` creates a brand new
   * `SourcingSession` instead of reusing (and re-merging requirement fields
   * into) the old one. This is the customer's only way to definitively start
   * over — without it, a confirmed/completed session's stale requirement,
   * recommendations and "already confirmed" banner would persist forever and
   * silently bleed into whatever the customer types next.
   */
  function startNewSearch() {
    setSessionId(null);
    setInput("");
    setBusy(false);
    setSubmitting(false);
    setError(null);
    setStage(null);
    setRequirement(null);
    setAssistantMessage(null);
    setMatches([]);
    setAlternatives([]);
    setSupplierCount(0);
    setRecommendations([]);
    setHeadline(null);
    setSelectedId(null);
    setConfirmedMessage(null);
    setShowAllOptions(false);
    setDecision(null);
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
      setDecision(result.decision ?? null);
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
      if (caught instanceof ApiError && caught.status === 429) {
        setError("You're sending requests too quickly. Please wait a moment and try again.");
      } else if (caught instanceof ApiError && caught.status === 409) {
        // The session this message targeted was already CONFIRMED (server-side
        // backstop — see the /message route). The customer's fix is the same
        // "New search" action, so reset first, then surface the server's own
        // explanation (startNewSearch() clears `error`, so it must run first).
        startNewSearch();
        setError(caught.message);
      } else {
        setError("I couldn't complete that sourcing request. Please try again.");
      }
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
        <p className="panel border-[color:var(--posh-border)] bg-[rgba(var(--posh-wash-rgb),0.04)] p-3 text-sm text-[color:var(--posh-fg)]" role="alert">
          {error}
        </p>
      )}

      {stage && (
        <>
          <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
            <SourcingProgressRail
              stage={stage}
              requirementComplete={requirementComplete}
              productCount={matches.length}
              supplierCount={supplierCount}
              optionCount={recommendations.length}
            />
            {/* Always available once a session has started — the only reliable
                way to leave stale requirement/recommendation state behind and
                begin sourcing a genuinely new request (see startNewSearch). */}
            <button
              type="button"
              onClick={startNewSearch}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[color:var(--posh-olive)] hover:text-[color:var(--posh-olive)]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              New search
            </button>
          </div>

          {assistantMessage && (
            <div className="panel p-4">
              <p className="whitespace-pre-line text-sm text-slate-700">{assistantMessage}</p>
            </div>
          )}

          {confirmedMessage && (
            <div className="panel border-[color:var(--posh-border)] bg-[rgba(var(--posh-wash-rgb),0.04)] p-4 space-y-3">
              <p className="text-sm text-[color:var(--posh-fg)]">{confirmedMessage}</p>
              <button
                type="button"
                onClick={startNewSearch}
                className="posh-btn-solid flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Start a new sourcing request
              </button>
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

          {/* Phase 8 — Price intelligence */}
          {decision && decision.priceIntelligence && (
            <PriceIntelligenceCard
              priceIntelligence={decision.priceIntelligence}
              trend={decision.trend}
              confidence={decision.confidence}
              timing={decision.timing}
            />
          )}

          {/* Phase 8 — Price history chart */}
          {decision && decision.priceIntelligence && (
            <PriceHistoryChart
              points={decision.priceIntelligence.historyPoints ?? []}
              forecastPoints={decision.forecast?.hasEnoughData ? decision.forecast.points : []}
              averagePrice={decision.priceIntelligence.averagePrice}
              method={decision.forecast?.method ?? "Statistical trend projection"}
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

          {/* Phase 8 — Risk panel */}
          {decision && decision.risks.length > 0 && (
            <RiskPanel risks={decision.risks} dataGaps={decision.dataGaps} />
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
            <Sparkles className="h-4 w-4 text-[color:var(--posh-fg)]" aria-hidden="true" />
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
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm transition-colors focus:border-[color:var(--posh-primary)] focus:bg-[color:var(--posh-bg-card)] focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)] disabled:opacity-60"
          aria-label="Describe the material you need"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="posh-btn-solid flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
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
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-colors hover:border-[color:var(--posh-primary)] hover:text-[color:var(--posh-fg)] disabled:opacity-50"
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
