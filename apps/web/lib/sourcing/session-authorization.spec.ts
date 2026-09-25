// §25 "Authorization" — verify that one user cannot access another customer's
// sourcing session.
//
// Prisma is mocked so this runs in the existing `lib/**/*.spec.ts` vitest suite
// with no database. What is being asserted is the SHAPE OF EVERY QUERY: each one
// must carry a userId predicate. That is the actual security property — if a
// query were ever changed to look up by id alone, these tests fail even though a
// happy-path integration test would still pass.

import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const findMany = vi.fn();
const updateMany = vi.fn();
const create = vi.fn();
const recommendationFindMany = vi.fn();
const siteFindFirst = vi.fn();
const siteFindMany = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    sourcingSession: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
      create: (...args: unknown[]) => create(...args),
    },
    sourcingRecommendation: {
      findMany: (...args: unknown[]) => recommendationFindMany(...args),
    },
    site: {
      findFirst: (...args: unknown[]) => siteFindFirst(...args),
      findMany: (...args: unknown[]) => siteFindMany(...args),
    },
  },
}));

const OWNER = "user-owner";
const ATTACKER = "user-attacker";
const SESSION_ID = "session-123";

function sessionRow(userId: string) {
  return {
    id: SESSION_ID,
    status: "RECOMMENDED",
    siteId: null,
    requirementJson: { material: "Cement", quantity: 500, unit: "bags", location: "Erode" },
    conversationJson: [],
    candidateProductsJson: [],
    candidateSuppliersJson: [],
    confirmedOrderId: null,
    confirmedRecommendationId: null,
    confirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId,
  };
}

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  updateMany.mockReset();
  create.mockReset();
  recommendationFindMany.mockReset();
  siteFindFirst.mockReset();
  siteFindMany.mockReset();
});

describe("getSession is always scoped by userId", () => {
  it("returns the session for its owner", async () => {
    const { getSession } = await import("./session-store");
    // Simulate the DB honouring the userId predicate.
    findFirst.mockImplementation(({ where }: any) =>
      where.userId === OWNER ? Promise.resolve(sessionRow(OWNER)) : Promise.resolve(null)
    );

    const session = await getSession(OWNER, SESSION_ID);

    expect(session).not.toBeNull();
    expect(session?.id).toBe(SESSION_ID);
    // The query MUST include the userId predicate.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION_ID, userId: OWNER } })
    );
  });

  it("returns null for a different user's session (indistinguishable from not-found)", async () => {
    const { getSession } = await import("./session-store");
    findFirst.mockImplementation(({ where }: any) =>
      where.userId === OWNER ? Promise.resolve(sessionRow(OWNER)) : Promise.resolve(null)
    );

    const session = await getSession(ATTACKER, SESSION_ID);

    // Null -> the route returns 404, so existence is never disclosed.
    expect(session).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION_ID, userId: ATTACKER } })
    );
  });
});

describe("writes cannot touch another user's session", () => {
  it("updateSession scopes the write by userId and reports zero rows affected", async () => {
    const { updateSession } = await import("./session-store");
    // A mismatched userId means the WHERE matches nothing.
    updateMany.mockResolvedValue({ count: 0 });

    const result = await updateSession(ATTACKER, SESSION_ID, { status: "ABANDONED" });

    expect(result).toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION_ID, userId: ATTACKER } })
    );
    // No follow-up read happened, because nothing was updated.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("saveRecommendations refuses to write when the session isn't owned", async () => {
    const { saveRecommendations } = await import("./session-store");
    findFirst.mockResolvedValue(null); // not owned by this caller

    await saveRecommendations(ATTACKER, SESSION_ID, []);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION_ID, userId: ATTACKER } })
    );
    // Ownership failed, so no recommendation rows were touched at all.
    expect(recommendationFindMany).not.toHaveBeenCalled();
  });

  it("getRecommendations returns nothing for a session the caller doesn't own", async () => {
    const { getRecommendations } = await import("./session-store");
    findFirst.mockResolvedValue(null);

    const rows = await getRecommendations(ATTACKER, SESSION_ID);

    expect(rows).toEqual([]);
    expect(recommendationFindMany).not.toHaveBeenCalled();
  });

  it("markSessionConfirmed scopes its update by userId", async () => {
    const { markSessionConfirmed } = await import("./session-store");
    updateMany.mockResolvedValue({ count: 0 });

    await markSessionConfirmed(ATTACKER, SESSION_ID, "rec-1", "order-1");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION_ID, userId: ATTACKER } })
    );
  });
});

describe("listSessions only ever lists the caller's own sessions", () => {
  it("filters by userId", async () => {
    const { listSessions } = await import("./session-store");
    findMany.mockResolvedValue([sessionRow(OWNER)]);

    await listSessions(OWNER);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: OWNER } }));
  });
});

// §5/§6/§8 of the "ask which site the order is for" feature — setSessionSite
// is the single place a session's authoritative siteId gets written from the
// AI-ordering UI, so its ownership/active-status/cross-customer checks are
// the actual security property under test here.
describe("setSessionSite never persists an unowned or inactive Site", () => {
  it("verifies the Site belongs to the caller AND is ACTIVE before writing it", async () => {
    const { setSessionSite } = await import("./session-store");
    siteFindFirst.mockResolvedValue({ id: "site-1" });
    updateMany.mockResolvedValue({ count: 1 });
    findFirst.mockResolvedValue(sessionRow(OWNER));

    await setSessionSite(OWNER, SESSION_ID, "site-1");

    expect(siteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "site-1", builderId: OWNER, status: "ACTIVE" } })
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SESSION_ID, userId: OWNER },
        data: { siteId: "site-1" },
      })
    );
  });

  it("drops a siteId that belongs to another builder without writing it", async () => {
    const { setSessionSite } = await import("./session-store");
    // Scoped-by-builderId lookup returns null for a foreign site.
    siteFindFirst.mockResolvedValue(null);

    const result = await setSessionSite(ATTACKER, SESSION_ID, "site-owned-by-someone-else");

    expect(result).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("drops a siteId belonging to the caller but no longer ACTIVE", async () => {
    const { setSessionSite } = await import("./session-store");
    // The status: "ACTIVE" predicate means an archived site's own row is
    // never returned, exactly like a foreign one.
    siteFindFirst.mockResolvedValue(null);

    const result = await setSessionSite(OWNER, SESSION_ID, "site-now-archived");

    expect(result).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("scopes the write by userId so it cannot touch another user's session", async () => {
    const { setSessionSite } = await import("./session-store");
    siteFindFirst.mockResolvedValue({ id: "site-1" });
    updateMany.mockResolvedValue({ count: 0 });

    const result = await setSessionSite(ATTACKER, SESSION_ID, "site-1");

    expect(result).toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION_ID, userId: ATTACKER } })
    );
  });

  it("allows clearing a session's site with null", async () => {
    const { setSessionSite } = await import("./session-store");
    updateMany.mockResolvedValue({ count: 1 });
    findFirst.mockResolvedValue(sessionRow(OWNER));

    await setSessionSite(OWNER, SESSION_ID, null);

    // No ownership lookup needed for clearing.
    expect(siteFindFirst).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { siteId: null } })
    );
  });
});

describe("listActiveSites only ever returns the caller's own ACTIVE sites", () => {
  it("filters by builderId and status", async () => {
    const { listActiveSites } = await import("./session-store");
    siteFindMany.mockResolvedValue([
      { id: "site-1", name: "ABC Construction", city: "Tiruppur", state: "Tamil Nadu" },
    ]);

    const sites = await listActiveSites(OWNER);

    expect(siteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { builderId: OWNER, status: "ACTIVE" } })
    );
    expect(sites).toEqual([
      { id: "site-1", name: "ABC Construction", location: "Tiruppur, Tamil Nadu" },
    ]);
  });
});

// "Make AI Site Selection Location-Aware" — findMatchingSitesForBuilder is
// the single server-side entry point for location matching. These tests
// verify it (a) stays scoped to the caller's own ACTIVE sites exactly like
// listActiveSites, and (b) actually defers to the shared pure matcher rather
// than reimplementing its own comparison.
describe("findMatchingSitesForBuilder — Test 8/9: scoping + location matching", () => {
  it("queries only the caller's own ACTIVE sites (never another builder's)", async () => {
    const { findMatchingSitesForBuilder } = await import("./session-store");
    siteFindMany.mockResolvedValue([
      { id: "site-erode", name: "Erode Site", city: "Erode", state: "Tamil Nadu" },
    ]);

    await findMatchingSitesForBuilder(OWNER, "Erode");

    expect(siteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { builderId: OWNER, status: "ACTIVE" } })
    );
  });

  it("Test 3 — returns only the location-matching subset in `matches`, all sites in `allSites`", async () => {
    const { findMatchingSitesForBuilder } = await import("./session-store");
    siteFindMany.mockResolvedValue([
      { id: "site-erode", name: "Erode Site", city: "Erode", state: "Tamil Nadu" },
      { id: "site-chennai", name: "Chennai Site", city: "Chennai", state: "Tamil Nadu" },
    ]);

    const result = await findMatchingSitesForBuilder(OWNER, "Chennai");

    expect(result.requestedLocation).toBe("Chennai");
    expect(result.matches.map((s) => s.id)).toEqual(["site-chennai"]);
    expect(result.allSites.map((s) => s.id).sort()).toEqual(["site-chennai", "site-erode"]);
  });

  it("Test 2/4 — returns empty matches (never a fallback site) when nothing matches", async () => {
    const { findMatchingSitesForBuilder } = await import("./session-store");
    siteFindMany.mockResolvedValue([
      { id: "site-erode", name: "Erode Site", city: "Erode", state: "Tamil Nadu" },
    ]);

    const result = await findMatchingSitesForBuilder(OWNER, "Chennai");

    expect(result.matches).toEqual([]);
    expect(result.allSites).toHaveLength(1);
  });

  it("Test 5/6 — no requestable location -> empty matches regardless of site count", async () => {
    const { findMatchingSitesForBuilder } = await import("./session-store");
    siteFindMany.mockResolvedValue([
      { id: "site-erode", name: "Erode Site", city: "Erode", state: "Tamil Nadu" },
    ]);

    const result = await findMatchingSitesForBuilder(OWNER, null);

    expect(result.requestedLocation).toBeNull();
    expect(result.matches).toEqual([]);
  });
});

describe("createSession will not tag a session to someone else's Site", () => {
  it("drops a siteId that does not belong to the caller", async () => {
    const { createSession } = await import("./session-store");
    // The Site lookup is itself scoped by builderId, so a foreign site yields null.
    siteFindFirst.mockResolvedValue(null);
    create.mockResolvedValue(sessionRow(ATTACKER));

    await createSession(ATTACKER, "site-owned-by-someone-else");

    expect(siteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "site-owned-by-someone-else", builderId: ATTACKER },
      })
    );
    // The unverified siteId must NOT be persisted.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ siteId: null }) })
    );
  });
});
