import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { isLegacyDashboardRoute, isProtectedRoute } from "@/lib/route-guards";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth?.user?.email;

  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/public")
  ) {
    return NextResponse.next();
  }

  // P0 fix (Phase 6): `/dashboard` isn't a real route in this app —
  // `/newdashboard` is the canonical customer dashboard. Redirect anyone
  // hitting the conventional path (old bookmarks/links) straight there
  // instead of letting it 404. Not a "retire a duplicate" migration — there
  // was never a working `/dashboard` implementation to begin with.
  if (isLegacyDashboardRoute(pathname)) {
    const target = new URL("/newdashboard", req.url);
    target.search = req.nextUrl.search;
    return NextResponse.redirect(target, { status: 308 });
  }

  if (pathname.startsWith("/auth/")) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/newdashboard", req.url));
    }
    return NextResponse.next();
  }

  const isProtected = isProtectedRoute(pathname);

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
