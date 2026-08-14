const API_BASE_PATH = "/api/builder";

// Preserves the HTTP status code of a failed builder API call so callers can
// distinguish a genuine 404 (resource doesn't exist) from a transient/auth/
// server error (5xx, network blip, etc). Previously all failures were thrown
// as generic Errors, so pages using notFound() on ANY catch would incorrectly
// render a permanent 404 page even for transient issues (e.g. a session/cookie
// race right after login) instead of retrying or showing a proper error state.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}


async function getCurrentUserHeaders(): Promise<Record<string, string>> {
  if (typeof window !== "undefined") {
    const { getSession } = await import("next-auth/react");
    const session = await getSession();
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
// routes under app/api/builder/* consistently return { message } on error
// response bodies (see e.g. app/api/builder/update-contact/route.ts).
async function extractErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.clone().json();
    if (data && typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    // Response body wasn't JSON (or was empty) — fall back below.
  }
  return fallback;
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
    const message = await extractErrorMessage(response, `Builder API request failed: ${response.status}`);
    throw new ApiError(message, response.status);
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
    const message = await extractErrorMessage(response, `Builder API delete failed: ${response.status}`);
    throw new ApiError(message, response.status);
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
    const message = await extractErrorMessage(response, `Builder API post failed: ${response.status}`);
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
