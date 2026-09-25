"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Send, Sparkles } from "lucide-react";

import { ApiError, builderApiGet, builderApiPatch, builderApiPost } from "@/lib/api";

import ApprovalBar from "./ApprovalBar";
import PriceHistoryChart from "./PriceHistoryChart";
import PriceIntelligenceCard from "./PriceIntelligenceCard";
import ProductMatchCard from "./ProductMatchCard";
import RecommendationCard from "./RecommendationCard";
import RequirementCard from "./RequirementCard";
import RiskPanel from "./RiskPanel";
import SiteStep from "./SiteStep";
import SourcingProgressRail from "./SourcingProgressRail";
import SupplierComparisonTable from "./SupplierComparisonTable";
import type {
  ProductMatchView,
  RequirementView,
  SessionResponse,
  SiteChoice,
  SiteSelectionReason,
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

  // Site the order is for — now LOCATION-AWARE ("Make AI Site Selection
  // Location-Aware"). siteId is the authoritative id persisted on the
  // session/order; every other site.* field is display-only and always
  // re-derived server-side (never trusted from client state alone at
  // confirm time). matchingSites/allSites/requestedLocation/
  // siteSelectionReason all come from the SAME server response
  // (GET /sourcing/sessions/[id]) — this component never decides matching
  // independently (§24).
  const [sitesLoading, setSitesLoading] = useState(true);
  const [siteId, setSiteId] = useState<string | null>(initialSession?.siteId ?? null);
  const [siteName, setSiteName] = useState<string | null>(initialSession?.siteName ?? null);
  const [siteLocation, setSiteLocation] = useState<string | null>(
    initialSession?.siteLocation ?? null
  );
  const [siteSelectionReason, setSiteSelectionReason] = useState<SiteSelectionReason>(
    initialSession?.siteSelectionReason ?? "NO_SITE"
  );
  const [requestedLocation, setRequestedLocation] = useState<string | null>(
    initialSession?.requestedLocation ?? null
  );
  const [matchingSites, setMatchingSites] = useState<SiteChoice[]>(
    initialSession?.matchingSites ?? []
  );
  const [allSites, setAllSites] = useState<SiteChoice[]>(initialSession?.allSites ?? []);
  const [savingSiteId, setSavingSiteId] = useState<string | null>(null);
  const [showSiteOverride, setShowSiteOverride] = useState(false);

  // Loads location-aware site data for a session that already exists, via
  // the single authoritative server route. Used both right after a turn
  // (fresh requirement -> fresh location) and after an explicit site pick.
  const refreshSiteMatch = useCallback(async (id: string) => {
    const session = await builderApiGet<SessionResponse>(`/sourcing/sessions/${id}`);
    setSiteId(session.siteId);
    setSiteName(session.siteName);
    setSiteLocation(session.siteLocation);
    setSiteSelectionReason(session.siteSelectionReason);
    setRequestedLocation(session.requestedLocation);
    setMatchingSites(session.matchingSites);
    setAllSites(session.allSites);
    return session;
  }, []);

  // Before any session exists, still show the customer's active sites (with
  // no location context yet) so SiteStep isn't stuck on "loading" forever if
  // the customer looks at the page before typing anything. Reuses the same
  // GET /sites endpoint the checkout SiteSelector uses — no parallel site API.
  useEffect(() => {
    if (sessionId) {
      setSitesLoading(false);
      return;
    }
    let active = true;
    builderApiGet<Array<{ id: string; name: string; city: string | null; state: string | null; status: string }>>(
      "/sites"
    )
      .then((data) => {
        if (!active) return;
        setAllSites(
          data
            .filter((s) => s.status === "ACTIVE")
            .map((s) => ({
              id: s.id,
              name: s.name,
              location: [s.city, s.state].filter(Boolean).join(", ") || null,
            }))
        );
      })
      .catch(() => {
        if (active) setAllSites([]);
      })
      .finally(() => {
        if (active) setSitesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  /** Reloads the persisted session so the UI has the stored recommendation ids. */
  const refreshSession = useCallback(
    async (id: string) => {
      const session = await refreshSiteMatch(id);
      setRecommendations(session.recommendations);
      setSelectedId((current) => current ?? session.recommendations[0]?.id ?? null);
    },
    [refreshSiteMatch]
  );

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const created = await builderApiPost<{ id: string }>("/sourcing/sessions", {});
    setSessionId(created.id);
    return created.id;
  }

  /**
   * Persists the customer's explicit choice (a location-matched site, the
   * sole no-location option, or an explicit override) as the session's
   * authoritative siteId. The server re-validates ownership and ACTIVE
   * status (setSessionSite) — the client never writes siteId anywhere else,
   * so the AI cannot bypass this check with a free-form site name.
   */
  const selectSite = useCallback(
    async (chosenSiteId: string) => {
      setSavingSiteId(chosenSiteId);
      try {
        const id = await ensureSession();
        const updated = await builderApiPatch<{
          siteId: string | null;
          siteName: string | null;
          siteSelectionReason: SiteSelectionReason;
        }>(`/sourcing/sessions/${id}`, { siteId: chosenSiteId });
        setSiteId(updated.siteId);
        setSiteName(updated.siteName);
        setSiteLocation(allSites.find((s) => s.id === updated.siteId)?.location ?? null);
        setSiteSelectionReason(updated.siteSelectionReason);
        if (updated.siteSelectionReason !== "USER_OVERRIDE") setShowSiteOverride(false);
      } catch {
        // Leave the previous selection in place; the ApprovalBar continues
        // to require a valid siteId before Proceed is enabled.
      } finally {
        setSavingSiteId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, allSites]
  );

  /**
   * §7: exactly one MATCHING site — may be auto-selected, but it must still
   * be persisted (not just assumed) and remains visible before confirmation
   * via SiteStep's "Site detected for this order" line.
   *
   * CRITICAL RULE CHANGE from the previous (location-unaware) behaviour: the
   * trigger is now `matchingSites.length === 1` (a requested location was
   * resolved AND exactly one active site matches it) — NEVER
   * `allSites.length === 1`. A single active site whose location does not
   * match the requirement, or when no location could be determined at all,
   * must NOT be auto-selected (§2/§4/§13).
   */
  useEffect(() => {
    if (
      sessionId &&
      !sitesLoading &&
      requestedLocation &&
      matchingSites.length === 1 &&
      siteId !== matchingSites[0].id &&
      savingSiteId === null
    ) {
      void selectSite(matchingSites[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sitesLoading, requestedLocation, matchingSites, siteId, savingSiteId]);

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
    // A new session starts with no site tagged yet — the location-match
    // auto-select effect (or SiteStep) re-runs against it once the next
    // message resolves a fresh requirement/location.
    setSiteId(null);
    setSiteName(null);
    setSiteLocation(null);
    setSiteSelectionReason("NO_SITE");
    setRequestedLocation(null);
    setMatchingSites([]);
    setShowSiteOverride(false);
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
      // Either way, the requirement's location may have changed THIS turn
      // (e.g. the customer just said "for my Chennai project"), so the
      // location match must always be re-resolved — never left stale from
      // a previous turn's location (or lack thereof).
      if (result.options.length > 0) {
        setSelectedId(null);
        await refreshSession(id);
      } else {
        setRecommendations([]);
        setSelectedId(null);
        await refreshSiteMatch(id);
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
    // A site must be selected (auto or explicit) before this order can be
    // confirmed — mirrors the same requirement enforced server-side in
    // /sourcing/sessions/[id]/confirm (§8: never trust the client alone).
    if (!sessionId || !selectedId || !siteId || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await builderApiPost<{ message: string; supplierName?: string }>(
        `/sourcing/sessions/${sessionId}/confirm`,
        { recommendationId: selectedId, siteId }
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

  const siteLabel = siteId && siteName ? `${siteName}${siteLocation ? ` – ${siteLocation}` : ""}` : null;

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

          {/* "Which site is this order for?" (§2-4 of the site-selection
              requirement) — shown as soon as a session exists so the answer
              is already known well before the customer reaches
              confirmation. Not shown once confirmed: the site is now fixed
              on the resulting order. */}
          {!confirmedMessage && (
            <SiteStep
              loading={sitesLoading}
              requestedLocation={requestedLocation}
              matchingSites={matchingSites}
              allSites={allSites}
              selectedSiteId={siteId}
              siteSelectionReason={siteSelectionReason}
              savingSiteId={savingSiteId}
              showOverride={showSiteOverride}
              onToggleOverride={() => setShowSiteOverride((v) => !v)}
              onSelect={selectSite}
            />
          )}

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
              siteLabel={siteLabel}
              siteSelectionReason={siteSelectionReason}
              requestedLocation={requestedLocation}
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
