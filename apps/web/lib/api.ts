import { useLoadingStore } from "@/lib/store/loading-store";

const API_BASE_PATH = "/api/builder";

// Toggle the global "pause the user" loading overlay around client-side
// builder API calls. Server-side calls (no window) are a no-op since the
// overlay is a client-only concern.
function startGlobalLoading() {
  if (typeof window !== "undefined") {
    useLoadingStore.getState().startLoading();
  }
}

function stopGlobalLoading() {
  if (typeof window !== "undefined") {
    useLoadingStore.getState().stopLoading();
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
  return {
    "X-User-Id": session.user.email,
    "X-User-Email": session.user.email,
    "X-User-Name": session.user.name || "",
    "X-User-Role": (session.user as any).role || "BUILDER",
  };
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

export async function builderApiGet<T>(path: string): Promise<T> {
  startGlobalLoading();
  try {
    const userHeaders = await getCurrentUserHeaders();
    if (!userHeaders["X-User-Email"]) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(buildApiUrl(path), {
      cache: "no-store",
      headers: userHeaders,
    });

    if (!response.ok) {
      throw new Error(`Builder API request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  } finally {
    stopGlobalLoading();
  }
}

export async function builderApiDelete(path: string): Promise<void> {
  startGlobalLoading();
  try {
    const userHeaders = await getCurrentUserHeaders();
    if (!userHeaders["X-User-Email"]) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(buildApiUrl(path), {
      method: "DELETE",
      headers: userHeaders,
    });

    if (!response.ok) {
      throw new Error(`Builder API delete failed: ${response.status}`);
    }
  } finally {
    stopGlobalLoading();
  }
}

export async function builderApiPost<TResponse>(path: string, body: unknown): Promise<TResponse> {
  startGlobalLoading();
  try {
    const userHeaders = await getCurrentUserHeaders();
    if (!userHeaders["X-User-Email"]) {
      throw new Error("Not authenticated");
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
      throw new Error(`Builder API post failed: ${response.status}`);
    }

    return response.json() as Promise<TResponse>;
  } finally {
    stopGlobalLoading();
  }
}

export async function builderApiPatch<TResponse>(path: string, body: unknown): Promise<TResponse> {
  startGlobalLoading();
  try {
    const userHeaders = await getCurrentUserHeaders();
    if (!userHeaders["X-User-Email"]) {
      throw new Error("Not authenticated");
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
      throw new Error(`Builder API patch failed: ${response.status}`);
    }

    return response.json() as Promise<TResponse>;
  } finally {
    stopGlobalLoading();
  }
}
