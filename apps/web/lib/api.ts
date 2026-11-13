import type { Session } from "next-auth";

const API_BASE_PATH = "/api/builder";

// Preserves the HTTP status code of a failed builder API call so callers can
// distinguish a genuine 404 (resource doesn't exist) from a transient/auth/
// server error (5xx, network blip, etc). Previously all failures were thrown
// as generic Errors, so pages using notFound() on ANY catch would incorrectly
// render a permanent 404 page even for transient issues (e.g. a session/cookie
// race right after login) instead of retrying or showing a proper error state.
export class ApiError extends Error {
  status: number;
  data?: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

// In-flight browser session promise deduplication.
// When multiple React components mount concurrently in the browser, each
// independently invokes builder API helpers which call getCurrentUserHeaders().
// Without deduplication, NextAuth's getSession() triggers concurrent network
// fetches to /api/auth/session (fan-out of 4-8 requests).
// Sharing the in-flight promise collapses concurrent resolutions into a single
// request while in-flight.
//
// NOTE: We deliberately do NOT cache resolved sessions and do NOT apply a TTL.
// As soon as the in-flight promise resolves or rejects, inFlightBrowserSession is
// reset to null in the finally block. Subsequent calls trigger a fresh getSession(),
// preserving strict session freshness and immediate account switching / logout semantics.
//
// AUTHENTICATION TRANSITION BARRIER:
// When an application-owned authentication transition begins (e.g. sign out, sign in,
// account switch), beginAuthTransition() / runBrowserAuthTransition() marks the browser
// state as transitioning, resets the in-flight promise, and increments sessionEpoch.
// While any transition is in progress (activeTransitions > 0):
// 1. New or pending builder API requests wait at the transition barrier (waitForAuthTransition)
//    rather than resolving or dispatching against a stale pre-transition identity.
// 2. If a session lookup was already in flight when the transition began, its result is
//    recognized as stale (requestEpoch !== sessionEpoch or activeTransitions > 0) and
//    discarded; the request queues at the barrier to resolve a fresh session after the
//    transition completes.
// 3. When the transition completes (successfully or on failure), the barrier is released,
//    allowing waiting callers to perform a fresh, deduplicated getSession() lookup reflecting
//    the actual current authentication state.
// 4. Waiting on the barrier is bounded by DEFAULT_AUTH_TRANSITION_TIMEOUT_MS to prevent
//    indefinite stalls; if a transition hangs, waiting callers fail safely without leaking
//    stale credentials, while the global barrier remains intact until explicitly ended.
export const DEFAULT_AUTH_TRANSITION_TIMEOUT_MS = 10_000;
let authTransitionTimeoutMs = DEFAULT_AUTH_TRANSITION_TIMEOUT_MS;

let inFlightBrowserSession: Promise<Session | null> | null = null;
let sessionEpoch = 0;
let activeTransitions = 0;
let authBroadcastChannel: BroadcastChannel | null = null;

interface TransitionWaiter {
  resolve: () => void;
  reject: (err: any) => void;
  timer: any;
}

let transitionWaiters: TransitionWaiter[] = [];

export function isAuthTransitioning(): boolean {
  return activeTransitions > 0;
}

export function setAuthTransitionTimeoutMsForTesting(ms: number): void {
  authTransitionTimeoutMs = ms;
}

export function resetAuthTransitionTimeoutMsForTesting(): void {
  authTransitionTimeoutMs = DEFAULT_AUTH_TRANSITION_TIMEOUT_MS;
}

export function clearBrowserSession(): void {
  inFlightBrowserSession = null;
  sessionEpoch++;
}

function notifyTransitionWaiters(): void {
  const waiters = transitionWaiters.slice();
  transitionWaiters = [];
  for (const waiter of waiters) {
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }
    waiter.resolve();
  }
}

/**
 * Synchronously marks an authentication transition as active.
 * Invalidate the current in-flight lookup, increments the session epoch,
 * and returns an idempotent cleanup callback to release the barrier.
 */
export function beginAuthTransition(): () => void {
  activeTransitions++;
  clearBrowserSession();
  let finished = false;

  return () => {
    if (finished) return;
    finished = true;
    activeTransitions = Math.max(0, activeTransitions - 1);
    clearBrowserSession();
    if (activeTransitions === 0) {
      notifyTransitionWaiters();
    }
  };
}

/**
 * Runs an asynchronous authentication action (such as signIn or signOut)
 * inside the authentication transition barrier.
 */
export async function runBrowserAuthTransition<T>(action: () => Promise<T>): Promise<T> {
  const endTransition = beginAuthTransition();
  try {
    return await action();
  } finally {
    endTransition();
  }
}

/**
 * Waits for any active authentication transitions to complete.
 * If activeTransitions === 0, resolves immediately.
 * Otherwise, queues the caller until all concurrent transitions settle,
 * bounded by authTransitionTimeoutMs.
 */
export function waitForAuthTransition(): Promise<void> {
  if (typeof window === "undefined" || activeTransitions === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let timer: any = null;

    const waiter: TransitionWaiter = {
      resolve: () => {
        if (timer) clearTimeout(timer);
        resolve();
      },
      reject: (err: any) => {
        if (timer) clearTimeout(timer);
        reject(err);
      },
      timer: null,
    };

    timer = setTimeout(() => {
      const idx = transitionWaiters.indexOf(waiter);
      if (idx !== -1) {
        transitionWaiters.splice(idx, 1);
      }
      // Fail the individual waiting request safely without clearing the global barrier
      reject(new ApiError("Authentication transition timed out", 408));
    }, authTransitionTimeoutMs);

    waiter.timer = timer;
    transitionWaiters.push(waiter);
  });
}

/** Close the BroadcastChannel listener (used for clean teardown in test environments) */
export function closeAuthListener(): void {
  if (authBroadcastChannel) {
    try {
      authBroadcastChannel.close();
    } catch {
      // ignore
    }
    authBroadcastChannel = null;
  }
}

/** Complete reset helper for unit and integration testing environments */
export function resetBrowserAuthForTesting(): void {
  inFlightBrowserSession = null;
  sessionEpoch = 0;
  activeTransitions = 0;
  for (const waiter of transitionWaiters) {
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }
  }
  transitionWaiters = [];
  authTransitionTimeoutMs = DEFAULT_AUTH_TRANSITION_TIMEOUT_MS;
  closeAuthListener();
}

function setupAuthListener(): void {
  if (typeof window === "undefined" || authBroadcastChannel) {
    return;
  }

  // NextAuth v5 communicates session events (such as signout and session invalidation)
  // via a BroadcastChannel named "next-auth". Listening to this channel ensures that
  // cross-tab authentication transitions immediately invalidate any in-flight
  // session resolution before subsequent API requests are dispatched.
  if (typeof BroadcastChannel !== "undefined") {
    try {
      authBroadcastChannel = new BroadcastChannel("next-auth");
      authBroadcastChannel.onmessage = (event) => {
        // NextAuth broadcasts { event: "session", data: { trigger: "signout" } } on logout.
        // It also broadcasts { trigger: "getSession" } on routine fetches, which must NOT
        // trigger session invalidation.
        const payload = event?.data;
        if (payload?.event === "session" && payload?.data?.trigger !== "getSession") {
          clearBrowserSession();
        }
      };
    } catch {
      // Ignore if BroadcastChannel is unsupported or restricted
    }
  }

  // Cross-tab storage fallback
  try {
    window.addEventListener("storage", (event) => {
      if (event.key && event.key.includes("next-auth")) {
        clearBrowserSession();
      }
    });
  } catch {
    // Ignore in non-browser environments
  }
}

async function getBrowserSession(): Promise<Session | null> {
  setupAuthListener();

  while (true) {
    // 1. Wait for any active auth transition barrier to be released
    await waitForAuthTransition();

    // 2. Capture epoch when about to check or create in-flight promise
    const requestEpoch = sessionEpoch;

    // 3. Deduplicate concurrent getSession() lookups
    if (!inFlightBrowserSession) {
      let currentPromise: Promise<Session | null> | null = null;

      currentPromise = (async () => {
        try {
          const { getSession } = await import("next-auth/react");
          const session = await getSession();
          return session;
        } finally {
          if (inFlightBrowserSession === currentPromise) {
            inFlightBrowserSession = null;
          }
        }
      })();

      inFlightBrowserSession = currentPromise;
    }

    let session: Session | null = null;
    try {
      session = await inFlightBrowserSession;
    } catch (err) {
      // If an auth transition started while awaiting, the error belongs to
      // the stale pre-transition lookup. Ignore it and retry fresh.
      if (sessionEpoch === requestEpoch && activeTransitions === 0) {
        throw err;
      }
      continue;
    }

    // 4. Stale lookup guard:
    // If an authentication state transition occurred while this getSession()
    // call was in flight (or if a transition is currently active), discard
    // the stale result and loop to await the barrier and resolve fresh.
    if (sessionEpoch !== requestEpoch || activeTransitions > 0) {
      continue;
    }

    return session;
  }
}

export async function getCurrentUserHeaders(): Promise<Record<string, string>> {
  if (typeof window !== "undefined") {
    const session = await getBrowserSession();
    if (!session?.user?.email) {
      return {};
    }
    return {
      "X-User-Id": session.user.email,
      "X-User-Email": session.user.email,
      "X-User-Name": session.user.name || "",
      "X-User-Role": (session.user as any).role || "BUILDER",
    };
  }

  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session?.user?.email) {
    return {};
  }
  const headers: Record<string, string> = {
    "X-User-Id": session.user.email,
    "X-User-Email": session.user.email,
    "X-User-Name": session.user.name || "",
    "X-User-Role": (session.user as any).role || "BUILDER",
  };

  // The server-side branch of this module makes an internal, server-to-server
  // HTTP call back into this same Next.js app's own /api/builder/* routes.
  // That internal fetch does NOT automatically carry the original browser
  // request's session cookie, which means middleware.ts's auth() check would
  // otherwise see it as unauthenticated and reject it with a 401 even though
  // the real user is logged in. Forward the incoming request's cookies so
  // middleware can validate the internal call exactly like the original one.
  const { cookies } = await import("next/headers");
  const cookieHeader = cookies().toString();
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader;
  }

  return headers;
}


function getServerOrigin() {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;

  if (!configuredOrigin) {
    return "http://127.0.0.1:3000";
  }

  return configuredOrigin.startsWith("http")
    ? configuredOrigin
    : `https://${configuredOrigin}`;
}

function buildApiUrl(path: string) {
  if (typeof window !== "undefined") {
    return `${API_BASE_PATH}${path}`;
  }

  return new URL(`${API_BASE_PATH}${path}`, getServerOrigin()).toString();
}

// Reads a failed response body (if JSON) to surface the server's actual
// error message (e.g. "This phone number is already in use by another
// account") instead of a generic "Builder API post/patch failed: 409" —
// routes under app/api/builder/* consistently return { message } or { error } on error
// response bodies (see e.g. app/api/builder/update-contact/route.ts).
async function extractErrorInfo(response: Response, fallback: string): Promise<{ message: string; data: any }> {
  let data: any = null;
  try {
    data = await response.clone().json();
    if (data && typeof data.message === "string" && data.message.trim()) {
      return { message: data.message, data };
    }
    if (data && typeof data.error === "string" && data.error.trim()) {
      return { message: data.error, data };
    }
  } catch {
    // Response body wasn't JSON (or was empty) — fall back below.
  }
  return { message: fallback, data };
}

async function extractErrorMessage(response: Response, fallback: string): Promise<string> {
  const info = await extractErrorInfo(response, fallback);
  return info.message;
}

export async function builderApiGet<T>(path: string): Promise<T> {
  const userHeaders = await getCurrentUserHeaders();
  if (!userHeaders["X-User-Email"]) {
    throw new ApiError("Not authenticated", 401);
  }

  const response = await fetch(buildApiUrl(path), {
    cache: "no-store",
    headers: userHeaders,
  });

  if (!response.ok) {
    const { message, data } = await extractErrorInfo(response, `Builder API request failed: ${response.status}`);
    throw new ApiError(message, response.status, data);
  }

  return response.json() as Promise<T>;
}


export async function builderApiDelete(path: string): Promise<void> {
  const userHeaders = await getCurrentUserHeaders();
  if (!userHeaders["X-User-Email"]) {
    throw new ApiError("Not authenticated", 401);
  }

  const response = await fetch(buildApiUrl(path), {
    method: "DELETE",
    headers: userHeaders,
  });

  if (!response.ok) {
    const { message, data } = await extractErrorInfo(response, `Builder API delete failed: ${response.status}`);
    throw new ApiError(message, response.status, data);
  }
}

export async function builderApiPost<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const userHeaders = await getCurrentUserHeaders();
  if (!userHeaders["X-User-Email"]) {
    throw new ApiError("Not authenticated", 401);
  }

  const response = await fetch(buildApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...userHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const { message, data } = await extractErrorInfo(response, `Builder API post failed: ${response.status}`);
    throw new ApiError(message, response.status, data);
  }

  return response.json() as Promise<TResponse>;
}

// Multipart/form-data POST helper (payment-proof screenshot upload etc).
// Deliberately does NOT set a Content-Type header — the browser must set it
// itself (including the multipart boundary) when the body is a FormData.
export async function builderApiUpload<TResponse>(path: string, formData: FormData): Promise<TResponse> {
  const userHeaders = await getCurrentUserHeaders();
  if (!userHeaders["X-User-Email"]) {
    throw new ApiError("Not authenticated", 401);
  }

  const response = await fetch(buildApiUrl(path), {
    method: "POST",
    headers: userHeaders,
    body: formData,
  });

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Builder API upload failed: ${response.status}`);
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<TResponse>;
}

export async function builderApiPatch<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const userHeaders = await getCurrentUserHeaders();
  if (!userHeaders["X-User-Email"]) {
    throw new ApiError("Not authenticated", 401);
  }

  const response = await fetch(buildApiUrl(path), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...userHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await extractErrorMessage(response, `Builder API patch failed: ${response.status}`);
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<TResponse>;
}
