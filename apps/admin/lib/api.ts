const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

const DEMO_ADMIN = {
  id: "admin.demo@buildmart.local",
  email: "admin.demo@buildmart.local",
  name: "Demo Admin",
  role: "ADMIN",
};

export async function adminApiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    headers: {
      "X-User-Id": DEMO_ADMIN.id,
      "X-User-Email": DEMO_ADMIN.email,
      "X-User-Name": DEMO_ADMIN.name,
      "X-User-Role": DEMO_ADMIN.role,
    },
  });

  if (!response.ok) {
    throw new Error(`Admin API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function adminApiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": DEMO_ADMIN.id,
      "X-User-Email": DEMO_ADMIN.email,
      "X-User-Name": DEMO_ADMIN.name,
      "X-User-Role": DEMO_ADMIN.role,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Admin API patch failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
