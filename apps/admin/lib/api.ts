const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

type AdminSessionUser = {
  id?: string;
  email?: string | null;
  name?: string | null;
  role?: string;
};

async function getSessionUser(): Promise<AdminSessionUser | null> {
  if (typeof window === "undefined") {
    const { auth } = await import("@/auth");
    const session = await auth();
    return (session?.user as AdminSessionUser) || null;
  }

  const { getSession } = await import("next-auth/react");
  const session = await getSession();
  return (session?.user as AdminSessionUser) || null;
}

async function getAdminHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const user = await getSessionUser();
  if (!user?.email) {
    throw new Error("Not authenticated");
  }

  return {
    ...(extra || {}),
    "X-User-Id": user.id || user.email,
    "X-User-Email": user.email,
    "X-User-Name": user.name || "Admin",
    "X-User-Role": user.role || "ADMIN",
  };
}

export async function adminApiGet<T>(path: string): Promise<T> {
  const headers = await getAdminHeaders();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Admin API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function adminApiPatch<T>(path: string, body: unknown): Promise<T> {
  const headers = await getAdminHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Admin API patch failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function adminApiPost<T>(path: string, body?: unknown): Promise<T> {
  const headers = await getAdminHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Admin API post failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

