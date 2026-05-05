import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const NEST_API_URL = "http://localhost:4000/api";

// Helper function to extract user from request headers
// In development, we accept user info from custom headers
function extractUserFromRequest(req: NextRequest): { id: string; email: string; name?: string; role?: string } | null {
  // Try to get from custom headers (set by middleware or test)
  const userId = req.headers.get("x-user-id");
  const userEmail = req.headers.get("x-user-email");
  
  if (userId && userEmail) {
    return {
      id: userId,
      email: userEmail,
      name: req.headers.get("x-user-name") || undefined,
      role: req.headers.get("x-user-role") || "SUPPLIER",
    };
  }
  
  // For now, return a demo user in development
  return {
    id: "supplier@demo",
    email: "supplier@demo@buildmart.local",
    name: "Demo Supplier",
    role: "SUPPLIER",
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = extractUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const path = req.nextUrl.pathname.replace("/api/supplier", "");
    const queryString = req.nextUrl.search;
    const fullUrl = `${NEST_API_URL}/supplier${path}${queryString}`;

    const response = await fetch(fullUrl, {
      method: "GET",
      headers: {
        "X-User-Id": user.id,
        "X-User-Email": user.email,
        "X-User-Name": user.name || "",
        "X-User-Role": user.role || "SUPPLIER",
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = extractUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const path = req.nextUrl.pathname.replace("/api/supplier", "");
    const body = await req.json();
    const fullUrl = `${NEST_API_URL}/supplier${path}`;

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "X-User-Id": user.id,
        "X-User-Email": user.email,
        "X-User-Name": user.name || "",
        "X-User-Role": user.role || "SUPPLIER",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = extractUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const path = req.nextUrl.pathname.replace("/api/supplier", "");
    const body = await req.json();
    const fullUrl = `${NEST_API_URL}/supplier${path}`;

    const response = await fetch(fullUrl, {
      method: "PATCH",
      headers: {
        "X-User-Id": user.id,
        "X-User-Email": user.email,
        "X-User-Name": user.name || "",
        "X-User-Role": user.role || "SUPPLIER",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
