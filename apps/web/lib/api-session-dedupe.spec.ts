import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetSession, mockNextAuthSignIn, mockNextAuthSignOut, mockAuth, mockCookies } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockNextAuthSignIn: vi.fn(),
  mockNextAuthSignOut: vi.fn(),
  mockAuth: vi.fn(),
  mockCookies: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  getSession: mockGetSession,
  signIn: mockNextAuthSignIn,
  signOut: mockNextAuthSignOut,
}));

vi.mock("@/auth", () => ({
  auth: mockAuth,
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

import { appSignIn, appSignOut } from "./auth-client";
import {
  builderApiGet,
  builderApiPost,
  builderApiDelete,
  builderApiPatch,
  builderApiUpload,
  getCurrentUserHeaders,
  ApiError,
  clearBrowserSession,
  beginAuthTransition,
  runBrowserAuthTransition,
  isAuthTransitioning,
  setAuthTransitionTimeoutMsForTesting,
  resetBrowserAuthForTesting,
} from "./api";

// Helper to poll until a mock function has been invoked N times
async function waitForCalls(spy: any, count = 1, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (spy.mock.calls.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for spy to be called ${count} times (got ${spy.mock.calls.length})`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("Browser-Side Authentication Session Request Deduplication (api.ts)", () => {
  const originalFetch = global.fetch;

  function setBrowserEnvironment() {
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }

  function setServerEnvironment() {
    delete (globalThis as any).window;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setBrowserEnvironment();
    resetBrowserAuthForTesting();

    // Default mock behavior for NextAuth client helpers
    mockNextAuthSignOut.mockImplementation(async () => {
      return { url: "/auth/login" };
    });
    mockNextAuthSignIn.mockImplementation(async () => {
      return { error: null, status: 200, ok: true, url: "/newdashboard" };
    });
  });

  afterEach(() => {
    setServerEnvironment();
    resetBrowserAuthForTesting();
    global.fetch = originalFetch;
  });

  describe("1. Concurrent Browser Session Deduplication", () => {
    it("deduplicates concurrent browser session requests to a single getSession call for multiple GET requests", async () => {
      let resolveSession: (value: any) => void;
      const sessionPromise = new Promise((resolve) => {
        resolveSession = resolve;
      });
      mockGetSession.mockReturnValue(sessionPromise);

      const mockFetch = vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url }),
      }));
      global.fetch = mockFetch as any;

      // Fire 3 concurrent API GET requests while getSession is pending
      const p1 = builderApiGet<{ endpoint: string }>("/cart");
      const p2 = builderApiGet<{ endpoint: string }>("/orders");
      const p3 = builderApiGet<{ endpoint: string }>("/advance-transactions");

      // Wait until getSession was initiated
      await waitForCalls(mockGetSession, 1);

      // Verify that only 1 getSession call has been dispatched so far
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // Resolve the deduplicated session
      resolveSession!({
        user: {
          email: "buyer@buildohub.in",
          name: "Buyer User",
          role: "BUILDER",
        },
      });

      const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

      // All 3 API calls completed successfully with correct endpoints
      expect(res1.endpoint).toBe("/api/builder/cart");
      expect(res2.endpoint).toBe("/api/builder/orders");
      expect(res3.endpoint).toBe("/api/builder/advance-transactions");

      // Verify getSession was still only called once across all 3 concurrent requests
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // Verify 3 distinct fetch requests were dispatched to backend with user headers
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "/api/builder/cart",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-User-Email": "buyer@buildohub.in",
          }),
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "/api/builder/orders",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-User-Email": "buyer@buildohub.in",
          }),
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        "/api/builder/advance-transactions",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-User-Email": "buyer@buildohub.in",
          }),
        })
      );
    });

    it("deduplicates session lookup across mixed concurrent HTTP methods (GET, POST, DELETE, PATCH, UPLOAD)", async () => {
      let resolveSession: (value: any) => void;
      const sessionPromise = new Promise((resolve) => {
        resolveSession = resolve;
      });
      mockGetSession.mockReturnValue(sessionPromise);

      const mockFetch = vi.fn().mockImplementation(async (url: string, opts: any) => ({
        ok: true,
        status: 200,
        json: async () => ({ method: opts?.method || "GET", url }),
      }));
      global.fetch = mockFetch as any;

      // Concurrently invoke GET, POST, DELETE, PATCH, and UPLOAD
      const pGet = builderApiGet("/cart");
      const pPost = builderApiPost("/cart", { productId: "p1", quantity: 2 });
      const pDel = builderApiDelete("/cart/item-1");
      const pPatch = builderApiPatch("/orders/ord-1", { status: "CONFIRMED" });
      const formData = new FormData();
      formData.append("file", "test");
      const pUpload = builderApiUpload("/payment-proof", formData);

      await waitForCalls(mockGetSession, 1);
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      resolveSession!({
        user: {
          email: "buyer@buildohub.in",
          name: "Buyer User",
          role: "BUILDER",
        },
      });

      await Promise.all([pGet, pPost, pDel, pPatch, pUpload]);

      // Exactly ONE session request was made for all 5 concurrent calls
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // 5 distinct HTTP calls were dispatched with their respective methods
      expect(mockFetch).toHaveBeenCalledTimes(5);
      const methods = mockFetch.mock.calls.map((call) => call[1]?.method || "GET");
      expect(methods).toEqual(["GET", "POST", "DELETE", "PATCH", "POST"]);
    });

    it("getCurrentUserHeaders directly deduplicates in-flight calls and returns identical headers", async () => {
      let resolveSession: (value: any) => void;
      const sessionPromise = new Promise((resolve) => {
        resolveSession = resolve;
      });
      mockGetSession.mockReturnValue(sessionPromise);

      const h1 = getCurrentUserHeaders();
      const h2 = getCurrentUserHeaders();
      const h3 = getCurrentUserHeaders();

      await waitForCalls(mockGetSession, 1);
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      resolveSession!({
        user: {
          email: "buyer@buildohub.in",
          name: "Buyer User",
          role: "BUILDER",
        },
      });

      const [res1, res2, res3] = await Promise.all([h1, h2, h3]);
      expect(res1).toEqual({
        "X-User-Id": "buyer@buildohub.in",
        "X-User-Email": "buyer@buildohub.in",
        "X-User-Name": "Buyer User",
        "X-User-Role": "BUILDER",
      });
      expect(res2).toEqual(res1);
      expect(res3).toEqual(res1);
    });
  });

  describe("2. Authentication Transition Barrier & Same-Tab/Cross-Tab Safety", () => {
    it("Test 1 — Sign-in while User A is logged in", async () => {
      // 1. Set the current session to User A (held pending)
      let resolveUserA: (session: any) => void;
      const userAPromise = new Promise((resolve) => {
        resolveUserA = resolve;
      });
      mockGetSession.mockReturnValueOnce(userAPromise);

      let resolveSignInUserB: (result: any) => void;
      const signInPromise = new Promise((resolve) => {
        resolveSignInUserB = resolve;
      });
      mockNextAuthSignIn.mockReturnValueOnce(signInPromise);

      const mockFetch = vi.fn().mockImplementation(async (url: string, opts: any) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url, user: opts?.headers?.["X-User-Email"] }),
      }));
      global.fetch = mockFetch as any;

      // 2. Start a pending session lookup (Request 1)
      const p1 = builderApiGet<{ user: string }>("/cart");
      await waitForCalls(mockGetSession, 1);
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // 3. Start appSignIn() for User B and leave NextAuth sign-in promise unresolved
      const signInTask = appSignIn("credentials", {
        email: "user-b@buildohub.in",
        redirect: false,
      });
      expect(isAuthTransitioning()).toBe(true);

      // 4. Initiate another builder API request during the pending transition (Request 2)
      const p2 = builderApiGet<{ user: string }>("/cart");

      // 5. Verify that the new API request is not dispatched using User A's credentials.
      // Even if User A's old pending lookup resolves right now:
      resolveUserA!({
        user: { email: "user-a@buildohub.in", name: "User A", role: "BUILDER" },
      });
      await new Promise((r) => setTimeout(r, 20));

      expect(mockFetch).not.toHaveBeenCalled();
      expect(isAuthTransitioning()).toBe(true);

      // 6. Complete the NextAuth sign-in as User B
      mockGetSession.mockResolvedValue({
        user: { email: "user-b@buildohub.in", name: "User B", role: "BUILDER" },
      });
      resolveSignInUserB!({
        error: null,
        status: 200,
        ok: true,
        url: "/newdashboard",
      });
      await signInTask;
      expect(isAuthTransitioning()).toBe(false);

      // 7. Verify that the waiting request resolves against User B's session
      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1.user).toBe("user-b@buildohub.in");
      expect(res2.user).toBe("user-b@buildohub.in");

      // 8. Verify that the actual API request is dispatched with User B's headers
      expect(mockFetch).toHaveBeenCalled();
      for (const call of mockFetch.mock.calls) {
        expect(call[1]?.headers?.["X-User-Email"]).toBe("user-b@buildohub.in");
      }
    });

    it("Test 2 — Logout while User A is logged in", async () => {
      // 1. Set the current session to User A (held pending)
      let resolveUserA: (session: any) => void;
      const userAPromise = new Promise((resolve) => {
        resolveUserA = resolve;
      });
      mockGetSession.mockReturnValueOnce(userAPromise);

      let resolveSignOut: (result: any) => void;
      const signOutPromise = new Promise((resolve) => {
        resolveSignOut = resolve;
      });
      mockNextAuthSignOut.mockReturnValueOnce(signOutPromise);

      const mockFetch = vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url }),
      }));
      global.fetch = mockFetch as any;

      // 2. Start a pending session lookup (Request 1)
      const p1 = builderApiGet("/cart");
      await waitForCalls(mockGetSession, 1);
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // 3. Start appSignOut() and leave the NextAuth sign-out promise unresolved
      const signOutTask = appSignOut({ redirect: false });
      expect(isAuthTransitioning()).toBe(true);

      // 4. Initiate a builder API request during the pending transition (Request 2)
      const p2 = builderApiGet("/cart");

      // Pre-attach rejection assertions
      const p1Assertion = expect(p1).rejects.toThrow("Not authenticated");
      const p2Assertion = expect(p2).rejects.toThrow("Not authenticated");

      // 5. Verify that it is not dispatched using User A's credentials
      resolveUserA!({
        user: { email: "user-a@buildohub.in", name: "User A", role: "BUILDER" },
      });
      await new Promise((r) => setTimeout(r, 20));

      expect(mockFetch).not.toHaveBeenCalled();
      expect(isAuthTransitioning()).toBe(true);

      // 6. Complete logout
      mockGetSession.mockResolvedValue(null);
      resolveSignOut!({ url: "/auth/login" });
      await signOutTask;
      expect(isAuthTransitioning()).toBe(false);

      // 7. Verify that the request does not use User A's session and follows unauthenticated API behaviour
      await Promise.all([p1Assertion, p2Assertion]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("Test 3 — Existing lookup becomes stale during transition", async () => {
      let resolveUserA: (session: any) => void;
      const userAPromise = new Promise((resolve) => {
        resolveUserA = resolve;
      });
      mockGetSession.mockReturnValueOnce(userAPromise);

      let resolveSignInUserB: (result: any) => void;
      const signInPromise = new Promise((resolve) => {
        resolveSignInUserB = resolve;
      });
      mockNextAuthSignIn.mockReturnValueOnce(signInPromise);

      const mockFetch = vi.fn().mockImplementation(async (url: string, opts: any) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url, user: opts?.headers?.["X-User-Email"] }),
      }));
      global.fetch = mockFetch as any;

      // 1. Start a pending getSession() for User A
      const p = builderApiGet<{ user: string }>("/cart");
      await waitForCalls(mockGetSession, 1);
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // 2. Begin a transition to User B
      const signInTask = appSignIn("credentials", { email: "user-b@buildohub.in", redirect: false });
      expect(isAuthTransitioning()).toBe(true);

      // 3. Resolve the old User A lookup while the transition remains pending
      resolveUserA!({
        user: { email: "user-a@buildohub.in", name: "User A", role: "BUILDER" },
      });
      await new Promise((r) => setTimeout(r, 20));

      // 4. Verify that its result cannot authorize any API request
      expect(mockFetch).not.toHaveBeenCalled();

      // 5. Complete the transition
      mockGetSession.mockResolvedValueOnce({
        user: { email: "user-b@buildohub.in", name: "User B", role: "BUILDER" },
      });
      resolveSignInUserB!({
        error: null,
        status: 200,
        ok: true,
        url: "/newdashboard",
      });
      await signInTask;
      expect(isAuthTransitioning()).toBe(false);

      // 6. Verify that the request obtains a fresh User B session
      const res = await p;
      expect(res.user).toBe("user-b@buildohub.in");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][1]?.headers?.["X-User-Email"]).toBe("user-b@buildohub.in");
    });

    it("Test 4 — Failed login while User A is authenticated", async () => {
      // 1. Set current session to User A
      mockGetSession.mockResolvedValueOnce({
        user: { email: "user-a@buildohub.in", name: "User A", role: "BUILDER" },
      });

      const mockFetch = vi.fn().mockImplementation(async (url: string, opts: any) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url, user: opts?.headers?.["X-User-Email"] }),
      }));
      global.fetch = mockFetch as any;

      const initial = await builderApiGet<{ user: string }>("/cart");
      expect(initial.user).toBe("user-a@buildohub.in");
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // 2. Start an appSignIn() operation for another account
      let resolveFailedSignIn: (result: any) => void;
      const failedSignInPromise = new Promise((resolve) => {
        resolveFailedSignIn = resolve;
      });
      mockNextAuthSignIn.mockReturnValueOnce(failedSignInPromise);

      const signInTask = appSignIn("credentials", {
        email: "bad-user@buildohub.in",
        password: "wrong-password",
        redirect: false,
      });

      // 3. Keep the transition pending
      expect(isAuthTransitioning()).toBe(true);

      // 4. Initiate a builder API request while transition is pending
      const p = builderApiGet<{ user: string }>("/cart");

      // Verify request is waiting at the barrier and not yet dispatched
      expect(mockFetch).toHaveBeenCalledTimes(1); // only the initial one

      // 5. Complete the sign-in with an unsuccessful result
      mockGetSession.mockResolvedValueOnce({
        user: { email: "user-a@buildohub.in", name: "User A", role: "BUILDER" },
      });
      resolveFailedSignIn!({
        error: "CredentialsSignin",
        status: 401,
        ok: false,
        url: null,
      });

      const signInResult = await signInTask;
      expect(signInResult?.error).toBe("CredentialsSignin");

      // 6. Verify that the barrier is released
      expect(isAuthTransitioning()).toBe(false);

      // 7. Verify that a fresh session lookup reflects the actual current authentication state (User A)
      const res = await p;
      expect(res.user).toBe("user-a@buildohub.in");

      // 8. Confirm that the application is not permanently blocked (subsequent call succeeds)
      mockGetSession.mockResolvedValueOnce({
        user: { email: "user-a@buildohub.in", name: "User A", role: "BUILDER" },
      });
      const resAfter = await builderApiGet<{ user: string }>("/cart");
      expect(resAfter.user).toBe("user-a@buildohub.in");
    });

    it("Test 5 — Concurrent transitions", async () => {
      let resolveT1: (res: any) => void;
      const pT1 = new Promise((r) => {
        resolveT1 = r;
      });
      let resolveT2: (res: any) => void;
      const pT2 = new Promise((r) => {
        resolveT2 = r;
      });

      const mockFetch = vi.fn().mockImplementation(async (url: string, opts: any) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url, user: opts?.headers?.["X-User-Email"] }),
      }));
      global.fetch = mockFetch as any;

      // 1. Start two overlapping authentication transitions
      const t1 = runBrowserAuthTransition(() => pT1);
      const t2 = runBrowserAuthTransition(() => pT2);
      expect(isAuthTransitioning()).toBe(true);

      // Queue an API request while both transitions are active
      const pReq = builderApiGet<{ user: string }>("/cart");

      // 2. Complete the first transition while the second remains pending
      resolveT1!({ ok: true });
      await t1;

      // 3. Verify that the barrier remains active
      expect(isAuthTransitioning()).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();

      // 4. Complete the second transition
      mockGetSession.mockResolvedValueOnce({
        user: { email: "user-final@buildohub.in", name: "Final User", role: "BUILDER" },
      });
      resolveT2!({ ok: true });
      await t2;

      // Barrier is now released
      expect(isAuthTransitioning()).toBe(false);

      // 5. Verify that waiting requests can now resolve using a fresh session
      const res = await pReq;
      expect(res.user).toBe("user-final@buildohub.in");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][1]?.headers?.["X-User-Email"]).toBe("user-final@buildohub.in");
    });

    it("Test 6 — Bounded waiting", async () => {
      setAuthTransitionTimeoutMsForTesting(50);

      const mockFetch = vi.fn().mockImplementation(async (url: string, opts: any) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url, user: opts?.headers?.["X-User-Email"] }),
      }));
      global.fetch = mockFetch as any;

      // 1. Start an authentication transition and leave it pending
      const endTransition = beginAuthTransition();
      expect(isAuthTransitioning()).toBe(true);

      // 2. Start a builder API request
      const p = builderApiGet("/cart");

      // Pre-attach rejection assertion so Node does not register an unhandled rejection while sleeping
      const pAssertion = expect(p).rejects.toThrow("Authentication transition timed out");

      // 3. Advance the clock beyond the configured transition-wait limit (50ms)
      await new Promise((r) => setTimeout(r, 80));

      // 4. Verify that the waiting request fails safely
      await pAssertion;

      // 5. Verify that no API request is dispatched with stale credentials
      expect(mockFetch).not.toHaveBeenCalled();

      // 6. Verify that the global transition barrier remains active
      expect(isAuthTransitioning()).toBe(true);

      // 7. Complete the transition
      endTransition();
      expect(isAuthTransitioning()).toBe(false);

      // 8. Verify that a subsequent API request can recover normally
      mockGetSession.mockResolvedValueOnce({
        user: { email: "recovered@buildohub.in", name: "Recovered User", role: "BUILDER" },
      });
      const res = await builderApiGet<{ user: string }>("/cart");
      expect(res.user).toBe("recovered@buildohub.in");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][1]?.headers?.["X-User-Email"]).toBe("recovered@buildohub.in");
    });

    it("Test 7 — Cross-tab invalidation", async () => {
      let resolvePending: (session: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePending = resolve;
      });

      mockGetSession.mockReturnValueOnce(pendingPromise);

      const mockFetch = vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url }),
      }));
      global.fetch = mockFetch as any;

      // 1. Start request for User A
      const p1 = builderApiGet("/cart");
      await waitForCalls(mockGetSession, 1);
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // 2. Cross-tab NextAuth session invalidation event (e.g. signout in another tab)
      const bc = new BroadcastChannel("next-auth");
      bc.postMessage({ event: "session", data: { trigger: "signout" } });
      await new Promise((r) => setTimeout(r, 20));

      // 3. Start request after cross-tab signout
      mockGetSession.mockResolvedValueOnce(null);
      const p2 = builderApiGet("/cart");

      // Pre-attach rejection assertions
      const p1Assertion = expect(p1).rejects.toThrow("Not authenticated");
      const p2Assertion = expect(p2).rejects.toThrow("Not authenticated");

      // 4. Resolve the original pending lookup
      resolvePending!({
        user: { email: "user-a@buildohub.in", name: "User A", role: "BUILDER" },
      });

      // Both requests reject with 401 unauthenticated
      await Promise.all([p1Assertion, p2Assertion]);

      // Two distinct getSession lookups were made
      expect(mockGetSession).toHaveBeenCalledTimes(2);
      expect(mockFetch).not.toHaveBeenCalled();

      bc.close();
    });
  });

  describe("3. Absence of Resolved Session Caching (Zero TTL / Freshness)", () => {
    it("does NOT cache resolved sessions; sequential calls trigger fresh getSession lookups", async () => {
      mockGetSession.mockResolvedValue({
        user: { email: "buyer@buildohub.in", name: "Buyer User", role: "BUILDER" },
      });

      const mockFetch = vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url }),
      }));
      global.fetch = mockFetch as any;

      // First call
      await builderApiGet("/cart");
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // Second sequential call AFTER first one resolved
      await builderApiGet("/orders");
      // Must have triggered a second, fresh getSession() lookup (zero TTL)
      expect(mockGetSession).toHaveBeenCalledTimes(2);

      // Third sequential call
      await builderApiGet("/advance-transactions");
      expect(mockGetSession).toHaveBeenCalledTimes(3);
    });

    it("reflects immediate account switching on subsequent calls without stale caching", async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string, opts: any) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url, user: opts?.headers?.["X-User-Email"] }),
      }));
      global.fetch = mockFetch as any;

      // 1. User A is logged in
      mockGetSession.mockResolvedValueOnce({
        user: { email: "user-a@buildohub.in", name: "User A", role: "BUILDER" },
      });
      const resA = await builderApiGet<{ user: string }>("/cart");
      expect(resA.user).toBe("user-a@buildohub.in");
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      // 2. User switches to User B (e.g. NextAuth session cookie changed)
      mockGetSession.mockResolvedValueOnce({
        user: { email: "user-b@buildohub.in", name: "User B", role: "BUILDER" },
      });
      const resB = await builderApiGet<{ user: string }>("/cart");
      expect(resB.user).toBe("user-b@buildohub.in");
      expect(mockGetSession).toHaveBeenCalledTimes(2);

      // 3. User logs out (null session)
      mockGetSession.mockResolvedValueOnce(null);
      await expect(builderApiGet("/cart")).rejects.toThrow("Not authenticated");
      expect(mockGetSession).toHaveBeenCalledTimes(3);
    });
  });

  describe("4. Error Propagation and Recovery", () => {
    it("propagates session resolution errors to all concurrent callers and clears in-flight state for subsequent retry", async () => {
      let rejectSession: (error: any) => void;
      const sessionPromise = new Promise((_, reject) => {
        rejectSession = reject;
      });
      mockGetSession.mockReturnValue(sessionPromise);

      const mockFetch = vi.fn();
      global.fetch = mockFetch as any;

      const p1 = builderApiGet("/cart");
      const p2 = builderApiGet("/orders");

      await waitForCalls(mockGetSession, 1);
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      const p1Assertion = expect(p1).rejects.toThrow("Network failure in getSession");
      const p2Assertion = expect(p2).rejects.toThrow("Network failure in getSession");

      // Reject the in-flight session resolution
      rejectSession!(new Error("Network failure in getSession"));

      // Both concurrent callers receive the rejection
      await Promise.all([p1Assertion, p2Assertion]);

      // No fetch calls were made to backend
      expect(mockFetch).not.toHaveBeenCalled();

      // Subsequent call after failure should retry cleanly and succeed if session recovers
      mockGetSession.mockResolvedValueOnce({
        user: { email: "buyer@buildohub.in", name: "Buyer User", role: "BUILDER" },
      });
      mockFetch.mockImplementationOnce(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ endpoint: url }),
      }));

      const resAfter = await builderApiGet<{ endpoint: string }>("/cart");
      expect(resAfter.endpoint).toBe("/api/builder/cart");
      expect(mockGetSession).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("5. Unauthenticated Session Handling", () => {
    it("handles unauthenticated (null) session by throwing 401 ApiError and allowing retry on login", async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const mockFetch = vi.fn();
      global.fetch = mockFetch as any;

      // Calling an API while unauthenticated should throw 401 ApiError
      const err = await builderApiGet("/cart").catch((e: any) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      expect((err as ApiError).message).toBe("Not authenticated");
      expect(mockFetch).not.toHaveBeenCalled();

      // After user logs in, next call succeeds
      mockGetSession.mockResolvedValueOnce({
        user: { email: "buyer@buildohub.in", name: "Buyer User", role: "BUILDER" },
      });
      mockFetch.mockImplementationOnce(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }));

      const res = await builderApiGet<{ ok: boolean }>("/cart");
      expect(res.ok).toBe(true);
      expect(mockGetSession).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("6. API Request Independence (No API Merging)", () => {
    it("does NOT deduplicate actual API requests; distinct HTTP requests are dispatched", async () => {
      mockGetSession.mockResolvedValue({
        user: { email: "buyer@buildohub.in", name: "Buyer User", role: "BUILDER" },
      });

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        const current = callCount;
        return {
          ok: true,
          status: 200,
          json: async () => ({ executionId: current }),
        };
      });
      global.fetch = mockFetch as any;

      // Two identical API calls fired concurrently to the same endpoint
      const p1 = builderApiGet<{ executionId: number }>("/cart");
      const p2 = builderApiGet<{ executionId: number }>("/cart");

      const [res1, res2] = await Promise.all([p1, p2]);

      // Both distinct HTTP requests reached the server independently
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(res1.executionId).toBe(1);
      expect(res2.executionId).toBe(2);
    });
  });

  describe("7. Server-Side Execution Isolation", () => {
    it("bypasses inFlightBrowserSession on the server and uses auth() and forwarded cookies", async () => {
      setServerEnvironment();

      mockAuth.mockResolvedValue({
        user: {
          email: "server-user@buildohub.in",
          name: "Server User",
          role: "BUILDER",
        },
      });

      mockCookies.mockReturnValue({
        toString: () => "authjs.session-token=mock-token",
      });

      const headers = await getCurrentUserHeaders();

      // Browser getSession was NOT called on server
      expect(mockGetSession).not.toHaveBeenCalled();

      // Server auth() was called
      expect(mockAuth).toHaveBeenCalledTimes(1);

      // Server cookies were forwarded
      expect(headers).toEqual({
        "X-User-Id": "server-user@buildohub.in",
        "X-User-Email": "server-user@buildohub.in",
        "X-User-Name": "Server User",
        "X-User-Role": "BUILDER",
        Cookie: "authjs.session-token=mock-token",
      });
    });
  });
});
