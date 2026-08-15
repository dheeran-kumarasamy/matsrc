import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Route prefixes that expose user-specific data (orders, reports, alerts,
// cart/checkout, watchlist, purchase orders, credit, profile, disputes,
// group-orders, dashboard) and therefore require an authenticated session.
//
// NOTE: the legacy "/dashboard" route was removed — /newdashboard is now the
// single builder dashboard, so only that prefix is listed here.
const PROTECTED_PREFIXES = [
  "/newdashboard",
  "/orders",
  "/reports",
  "/notifications",
  "/watchlist",
  "/purchase-orders",
  "/credit",
  "/cart",
  "/checkout",
  "/disputes",
  "/group-orders",
  "/profile",
  "/sites",
  // AI Sourcing Assistant — session/conversation state is per-customer, so the
  // page requires a signed-in builder just like every other portal route. The
  // /api/builder/sourcing/* endpoints are already covered by the
  // /api/builder prefix check below.
  "/sourcing",
];


export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth?.user?.email;

  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/public")
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/auth/")) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/newdashboard", req.url));
    }
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  // Protect the builder-facing user-data API routes as well.
  const isProtectedApi = pathname.startsWith("/api/builder");

  if ((isProtected || isProtectedApi) && !isLoggedIn) {
    if (isProtectedApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$|.*\\.ico$).*)"],
};
