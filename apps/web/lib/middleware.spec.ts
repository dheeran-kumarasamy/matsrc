import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Mock @/auth so middleware's wrapper invokes the inner handler directly
vi.mock("@/auth", () => ({
  auth: vi.fn((handler: any) => (req: any, ctx?: any) => handler(req, ctx)),
}));

import middleware from "../middleware";

function createMockRequest(
  urlStr: string,
  options: {
    headers?: Record<string, string>;
    auth?: {
      user?: {
        id?: string;
        email?: string | null;
        name?: string | null;
        role?: string;
      };
    } | null;
  } = {}
): NextRequest {
  const url = new URL(urlStr);
  const headers = new Headers(options.headers || {});
  const req = new NextRequest(url, { headers });
  // Attach auth context populated by NextAuth
  (req as any).auth = options.auth ?? null;
  return req;
}

describe("apps/web/middleware.ts — Edge Identity Hardening & Anti-Spoofing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Scenario 1: Authenticated request with spoofed x-user-id", () => {
    it("overwrites spoofed x-user-id with authoritative session id", async () => {
      const nextSpy = vi.spyOn(NextResponse, "next");

      const req = createMockRequest("https://buildohub.in/products", {
        headers: {
          "x-user-id": "spoofed-victim-id",
          "x-user-email": "victim@builder.in",
          "x-user-role": "BUILDER",
        },
        auth: {
          user: {
            id: "verified-alice-id",
            email: "alice@builder.in",
            role: "BUILDER",
            name: "Alice Builder",
          },
        },
      });

      await (middleware as any)(req);

      expect(nextSpy).toHaveBeenCalled();
      const call = nextSpy.mock.calls[0][0] as any;
      const outgoingHeaders: Headers = call.request.headers;

      expect(outgoingHeaders.get("x-user-id")).toBe("verified-alice-id");
      expect(outgoingHeaders.get("x-user-email")).toBe("alice@builder.in");
      expect(outgoingHeaders.get("x-user-id")).not.toBe("spoofed-victim-id");
    });
  });

  describe("Scenario 2: Authenticated Builder request with spoofed x-user-role: ADMIN", () => {
    it("overwrites spoofed x-user-role with authoritative session role BUILDER", async () => {
      const nextSpy = vi.spyOn(NextResponse, "next");

      const req = createMockRequest("https://buildohub.in/products", {
        headers: {
          "x-user-role": "ADMIN",
        },
        auth: {
          user: {
            id: "builder-bob-id",
            email: "bob@builder.in",
            role: "BUILDER",
            name: "Bob Builder",
          },
        },
      });

      await (middleware as any)(req);

      expect(nextSpy).toHaveBeenCalled();
      const call = nextSpy.mock.calls[0][0] as any;
      const outgoingHeaders: Headers = call.request.headers;

      expect(outgoingHeaders.get("x-user-role")).toBe("BUILDER");
      expect(outgoingHeaders.get("x-user-role")).not.toBe("ADMIN");
    });
  });

  describe("Scenario 3: Unauthenticated request with spoofed identity headers", () => {
    it("purges all client-supplied x-user-* headers on unauthenticated requests", async () => {
      const nextSpy = vi.spyOn(NextResponse, "next");

      const req = createMockRequest("https://buildohub.in/products", {
        headers: {
          "x-user-id": "attacker-id",
          "x-user-email": "admin@buildohub.in",
          "x-user-role": "ADMIN",
          "x-user-name": "Super Admin",
        },
        auth: null,
      });

      await (middleware as any)(req);

      expect(nextSpy).toHaveBeenCalled();
      const call = nextSpy.mock.calls[0][0] as any;
      const outgoingHeaders: Headers = call.request.headers;

      expect(outgoingHeaders.get("x-user-id")).toBeNull();
      expect(outgoingHeaders.get("x-user-email")).toBeNull();
      expect(outgoingHeaders.get("x-user-role")).toBeNull();
      expect(outgoingHeaders.get("x-user-name")).toBeNull();
    });

    it("rejects unauthenticated caller on protected /api/builder routes with 401 Unauthorized", async () => {
      const req = createMockRequest("https://buildohub.in/api/builder/cart", {
        headers: {
          "x-user-id": "forged-id",
          "x-user-email": "forged@builder.in",
        },
        auth: null,
      });

      const response = (await (middleware as any)(req)) as NextResponse;

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
    });
  });

  describe("Scenario 4: Missing or incomplete session information", () => {
    it("treats session with missing email as unauthenticated and strips headers", async () => {
      const nextSpy = vi.spyOn(NextResponse, "next");

      const req = createMockRequest("https://buildohub.in/products", {
        headers: {
          "x-user-id": "dangling-id",
          "x-user-email": "dangling@builder.in",
        },
        auth: {
          user: {
            id: "dangling-id",
            email: null, // missing email
          },
        },
      });

      await (middleware as any)(req);

      expect(nextSpy).toHaveBeenCalled();
      const call = nextSpy.mock.calls[0][0] as any;
      const outgoingHeaders: Headers = call.request.headers;

      expect(outgoingHeaders.get("x-user-id")).toBeNull();
      expect(outgoingHeaders.get("x-user-email")).toBeNull();
      expect(outgoingHeaders.get("x-user-role")).toBeNull();
    });

    it("redirects unauthenticated browser requests for protected UI pages to /auth/login", async () => {
      const req = createMockRequest("https://buildohub.in/newdashboard", {
        headers: {
          "x-user-id": "fake-id",
        },
        auth: null,
      });

      const response = (await (middleware as any)(req)) as NextResponse;

      expect(response.status).toBe(307); // NextResponse.redirect default
      expect(response.headers.get("location")).toContain("/auth/login?callbackUrl=%2Fnewdashboard");
    });
  });

  describe("Scenario 5: Valid authenticated request with correct identity propagation", () => {
    it("correctly sets all identity headers from verified session", async () => {
      const nextSpy = vi.spyOn(NextResponse, "next");

      const req = createMockRequest("https://buildohub.in/api/builder/cart", {
        auth: {
          user: {
            id: "builder-user-456",
            email: "chandra@buildohub.in",
            name: "Chandra Contractor",
            role: "BUILDER",
          },
        },
      });

      await (middleware as any)(req);

      expect(nextSpy).toHaveBeenCalled();
      const call = nextSpy.mock.calls[0][0] as any;
      const outgoingHeaders: Headers = call.request.headers;

      expect(outgoingHeaders.get("x-user-id")).toBe("builder-user-456");
      expect(outgoingHeaders.get("x-user-email")).toBe("chandra@buildohub.in");
      expect(outgoingHeaders.get("x-user-name")).toBe("Chandra Contractor");
      expect(outgoingHeaders.get("x-user-role")).toBe("BUILDER");
    });

    it("falls back to user.email when user.id is unset in verified session", async () => {
      const nextSpy = vi.spyOn(NextResponse, "next");

      const req = createMockRequest("https://buildohub.in/api/builder/cart", {
        auth: {
          user: {
            email: "contractor@buildohub.in",
            role: "BUILDER",
          },
        },
      });

      await (middleware as any)(req);

      expect(nextSpy).toHaveBeenCalled();
      const call = nextSpy.mock.calls[0][0] as any;
      const outgoingHeaders: Headers = call.request.headers;

      expect(outgoingHeaders.get("x-user-id")).toBe("contractor@buildohub.in");
      expect(outgoingHeaders.get("x-user-email")).toBe("contractor@buildohub.in");
      expect(outgoingHeaders.get("x-user-role")).toBe("BUILDER");
    });
  });
});

