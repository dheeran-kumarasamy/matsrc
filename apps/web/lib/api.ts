const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

const DEMO_USER = {
  id: "builder.demo@buildmart.local",
  email: "builder.demo@buildmart.local",
  name: "Demo Builder",
  role: "BUILDER",
};

export async function builderApiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    headers: {
      "X-User-Id": DEMO_USER.id,
      "X-User-Email": DEMO_USER.email,
      "X-User-Name": DEMO_USER.name,
      "X-User-Role": DEMO_USER.role,
    },
  });

  if (!response.ok) {
    throw new Error(`Builder API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function builderApiDelete(path: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "DELETE",
    headers: {
      "X-User-Id": DEMO_USER.id,
      "X-User-Email": DEMO_USER.email,
      "X-User-Name": DEMO_USER.name,
      "X-User-Role": DEMO_USER.role,
    },
  });

  if (!response.ok) {
    throw new Error(`Builder API delete failed: ${response.status}`);
  }
}

export async function builderApiPost<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": DEMO_USER.id,
      "X-User-Email": DEMO_USER.email,
      "X-User-Name": DEMO_USER.name,
      "X-User-Role": DEMO_USER.role,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Builder API post failed: ${response.status}`);
  }

  return response.json() as Promise<TResponse>;
}
