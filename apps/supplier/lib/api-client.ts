const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export async function callSupplierApi(
  path: string,
  method: string = "GET",
  body?: any,
  token?: string
) {
  const headers: any = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "API Error" }));
    throw new Error(error.message || `API error: ${response.statusText}`);
  }

  return response.json();
}
