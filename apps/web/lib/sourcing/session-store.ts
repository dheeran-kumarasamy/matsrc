// SourcingSession persistence + AUTHORIZATION (§12, §20, §21).
//
// SECURITY INVARIANT (the single most important rule in this file): every read
// and every write is scoped by `userId`. There is no function here that loads a
// session by id alone. This mirrors the pattern used across the existing
// builder routes (e.g. BuilderRfqsService's `findFirst({ where: { id, userId } })`)
// and is what makes cross-customer access structurally impossible rather than
// merely unlikely.
//
// The session-not-found and session-owned-by-someone-else cases deliberately
// return the SAME result (null -> 404), so the API never discloses that another
// customer's session exists.

import { prisma } from "@/lib/builder-db";
import type { Prisma, SourcingSessionStatus } from "@matsrc/db";

import type {
  RankedSupplierOption,
  SourcingProductMatch,
  SourcingRequirement,
  SourcingSupplierCandidate,
  SourcingToolName,
  SourcingTurn,
} from "./types";
import { EMPTY_REQUIREMENT } from "./types";
import { validateRequirement } from "./requirement-schema";

/** Max conversation turns retained per session (bounds row growth). */
export const MAX_TURNS = 40;

export type SourcingSessionView = {
  id: string;
  status: SourcingSessionStatus;
  siteId: string | null;
  requirement: SourcingRequirement;
  conversation: SourcingTurn[];
  candidateProducts: SourcingProductMatch[];
  candidateSuppliers: SourcingSupplierCandidate[];
  confirmedOrderId: string | null;
  confirmedRecommendationId: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toView(row: {
  id: string;
  status: SourcingSessionStatus;
  siteId: string | null;
  requirementJson: unknown;
  conversationJson: unknown;
  candidateProductsJson: unknown;
  candidateSuppliersJson: unknown;
  confirmedOrderId: string | null;
  confirmedRecommendationId: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SourcingSessionView {
  return {
    id: row.id,
    status: row.status,
    siteId: row.siteId,
    // Re-validate on read: a row written by an older version of the schema must
    // never reach the UI/tools in an unexpected shape.
    requirement: row.requirementJson
      ? validateRequirement(row.requirementJson)
      : { ...EMPTY_REQUIREMENT, constraints: [] },
    conversation: asArray<SourcingTurn>(row.conversationJson),
    candidateProducts: asArray<SourcingProductMatch>(row.candidateProductsJson),
    candidateSuppliers: asArray<SourcingSupplierCandidate>(row.candidateSuppliersJson),
    confirmedOrderId: row.confirmedOrderId,
    confirmedRecommendationId: row.confirmedRecommendationId,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const SESSION_SELECT = {
  id: true,
  status: true,
  siteId: true,
  requirementJson: true,
  conversationJson: true,
  candidateProductsJson: true,
  candidateSuppliersJson: true,
  confirmedOrderId: true,
  confirmedRecommendationId: true,
  confirmedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Creates a new sourcing session owned by `userId`. */
export async function createSession(
  userId: string,
  siteId?: string | null
): Promise<SourcingSessionView> {
  // A siteId is only accepted if that Site really belongs to this builder —
  // otherwise a caller could tag their session to someone else's project.
  let verifiedSiteId: string | null = null;
  if (siteId) {
    const site = await prisma.site.findFirst({
      where: { id: siteId, builderId: userId },
      select: { id: true },
    });
    verifiedSiteId = site?.id ?? null;
  }

  const row = await prisma.sourcingSession.create({
    data: {
      userId,
      siteId: verifiedSiteId,
      status: "COLLECTING",
      requirementJson: { ...EMPTY_REQUIREMENT, constraints: [] } as unknown as Prisma.InputJsonValue,
      conversationJson: [] as unknown as Prisma.InputJsonValue,
    },
    select: SESSION_SELECT,
  });

  return toView(row);
}

/**
 * Loads one session, scoped to its owner.
 *
 * Returns null both when the session does not exist AND when it belongs to
 * another user — the caller maps both to 404 so existence is never disclosed.
 */
export async function getSession(
  userId: string,
  sessionId: string
): Promise<SourcingSessionView | null> {
  const row = await prisma.sourcingSession.findFirst({
    where: { id: sessionId, userId },
    select: SESSION_SELECT,
  });
  return row ? toView(row) : null;
}

/** Lists the caller's own sessions, most recently updated first. */
export async function listSessions(userId: string, take = 20): Promise<SourcingSessionView[]> {
  const rows = await prisma.sourcingSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(take, 1), 50),
    select: SESSION_SELECT,
  });
  return rows.map(toView);
}

export type SessionUpdate = {
  status?: SourcingSessionStatus;
  requirement?: SourcingRequirement;
  conversation?: SourcingTurn[];
  candidateProducts?: SourcingProductMatch[];
  candidateSuppliers?: SourcingSupplierCandidate[];
};

/**
 * Updates a session, scoped to its owner.
 *
 * Uses updateMany + a userId predicate (rather than update-by-id) so an
 * unauthorized write affects ZERO rows instead of throwing after the fact.
 * Returns null when nothing was updated, i.e. not found or not owned.
 */
export async function updateSession(
  userId: string,
  sessionId: string,
  update: SessionUpdate
): Promise<SourcingSessionView | null> {
  const data: Prisma.SourcingSessionUpdateManyMutationInput = {};

  if (update.status) data.status = update.status;
  if (update.requirement) {
    data.requirementJson = update.requirement as unknown as Prisma.InputJsonValue;
  }
  if (update.conversation) {
    // Keep only the most recent turns so a long-running session can't grow the
    // row without bound.
    data.conversationJson = update.conversation.slice(
      -MAX_TURNS
    ) as unknown as Prisma.InputJsonValue;
  }
  if (update.candidateProducts) {
    data.candidateProductsJson = update.candidateProducts as unknown as Prisma.InputJsonValue;
  }
  if (update.candidateSuppliers) {
    data.candidateSuppliersJson = update.candidateSuppliers as unknown as Prisma.InputJsonValue;
  }

  const result = await prisma.sourcingSession.updateMany({
    where: { id: sessionId, userId },
    data,
  });

  if (result.count === 0) return null;
  return getSession(userId, sessionId);
}

/**
 * Replaces the stored recommendations for a session with a freshly computed
 * ranking. Ownership is verified BEFORE any write.
 *
 * Recommendations are replaced (not appended) because they are a snapshot of
 * the latest search — a stale ranking must never be shown alongside a current
 * one. The rows persist the deterministic figures verbatim so §21's "store
 * enough information to explain why the recommendation was produced" holds.
 */
export async function saveRecommendations(
  userId: string,
  sessionId: string,
  options: RankedSupplierOption[]
): Promise<void> {
  const owned = await prisma.sourcingSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  if (!owned) return;

  await prisma.$transaction([
    prisma.sourcingRecommendation.deleteMany({ where: { sessionId } }),
    ...options.map((option) =>
      prisma.sourcingRecommendation.create({
        data: {
          sessionId,
          supplierId: option.supplierId,
          productId: option.productId || null,
          rank: option.rank,
          score: option.recommendationScore,
          quantity: option.landedCost.quantity,
          unit: option.candidate.unit,
          unitMaterialPrice: option.landedCost.unitMaterialPrice,
          materialCost: option.landedCost.materialCost,
          freightCost: option.landedCost.freightCost,
          deliveryCharges: option.landedCost.deliveryCharges,
          handlingCharges: option.landedCost.handlingCharges,
          taxAmount: option.landedCost.taxAmount,
          estimatedLandedCost: option.landedCost.estimatedLandedCost,
          unitLandedCost: option.landedCost.unitLandedCost,
          deliveryDays: option.candidate.estimatedDeliveryDays,
          reliabilityScore: option.candidate.reliabilityScore,
          specificationMatch: option.candidate.specificationMatch,
          reasonsJson: option.reasons as unknown as Prisma.InputJsonValue,
          dataGapsJson: option.dataGaps as unknown as Prisma.InputJsonValue,
        },
      })
    ),
  ]);
}

/** Reads back the stored recommendations for a session the caller owns. */
export async function getRecommendations(userId: string, sessionId: string) {
  const owned = await prisma.sourcingSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  if (!owned) return [];

  return prisma.sourcingRecommendation.findMany({
    where: { sessionId },
    orderBy: { rank: "asc" },
    include: { supplier: { select: { companyName: true, region: true, verifiedBadge: true } } },
  });
}

/**
 * Audit-trail write (§21). Records the tool, its validated input, a compact
 * result summary, latency, outcome and approval status.
 *
 * An audit failure must not fail the customer's request, but it is logged
 * loudly so it cannot pass unnoticed. Never stores secrets or raw provider
 * payloads.
 */
export async function recordToolInvocation(params: {
  userId: string;
  sessionId: string;
  tool: SourcingToolName;
  input?: unknown;
  resultSummary?: unknown;
  status: "OK" | "EMPTY" | "VALIDATION_ERROR" | "PROVIDER_ERROR" | "ERROR";
  latencyMs?: number;
  approvalStatus?: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
}): Promise<void> {
  try {
    await prisma.sourcingToolInvocation.create({
      data: {
        sessionId: params.sessionId,
        userId: params.userId,
        tool: params.tool,
        inputJson: (params.input ?? null) as Prisma.InputJsonValue,
        resultSummaryJson: (params.resultSummary ?? null) as Prisma.InputJsonValue,
        status: params.status,
        latencyMs: params.latencyMs ?? null,
        approvalStatus: params.approvalStatus ?? "NOT_REQUIRED",
      },
    });
  } catch (error) {
    console.error("[sourcing] audit write failed:", error);
  }
}

/**
 * Marks a session CONFIRMED after the customer approved a recommendation and
 * the enquiry was created. Ownership-scoped like every other write.
 */
export async function markSessionConfirmed(
  userId: string,
  sessionId: string,
  recommendationId: string,
  orderId: string | null
): Promise<void> {
  await prisma.sourcingSession.updateMany({
    where: { id: sessionId, userId },
    data: {
      status: "CONFIRMED",
      confirmedRecommendationId: recommendationId,
      confirmedOrderId: orderId,
      confirmedAt: new Date(),
    },
  });
}
