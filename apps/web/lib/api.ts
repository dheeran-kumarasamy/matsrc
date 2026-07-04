const API_BASE_PATH = "/api/builder";

const DEMO_USER = {
  id: "builder.demo@buildmart.local",
  email: "builder.demo@buildmart.local",
  name: "Demo Builder",
  role: "BUILDER",
};

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
  const response = await fetch(buildApiUrl(path), {
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
  const response = await fetch(buildApiUrl(path), {
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
  const response = await fetch(buildApiUrl(path), {
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
