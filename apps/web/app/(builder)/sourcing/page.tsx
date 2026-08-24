import Link from "next/link";
import { LogIn, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import SourcingAssistant from "@/components/sourcing/SourcingAssistant";

// AI Sourcing Assistant entry point in the builder portal.
//
// Route is protected at the edge by middleware.ts (/sourcing is in
// PROTECTED_PREFIXES), which already redirects unauthenticated browser
// navigations to /auth/login. This page ADDITIONALLY checks the session
// itself (server-side, via the same NextAuth `auth()` helper used
// everywhere else in this app — see lib/builder-db.ts) so the dashboard and
// its data are never conditionally hidden by CSS alone and never assembled
// for a request that isn't actually authenticated, regardless of how the
// route was reached.
//
// The heavy lifting is a client component because the flow is interactive; all
// data access and every AI call happen server-side behind
// /api/builder/sourcing/*, so no API key is ever exposed to the browser.

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Sourcing Assistant",
  description:
    "Tell us what material you need. Our AI Sourcing Assistant will help you find the best sourcing option.",
};

export default async function SourcingPage() {
  const session = await auth();
  const isSignedIn = !!session?.user?.email;

  // REQ: the sourcing dashboard (and everything it fetches) must not be
  // rendered at all for a signed-out visitor — not hidden, not present in
  // the response and toggled with CSS. Show a polished sign-in prompt
  // instead, consistent with the design system used elsewhere (see e.g.
  // UserSessionBadge's "Sign in" state and the watchlist/orders empty
  // states).
  if (!isSignedIn) {
    return (
      <div className="posh-body flex min-h-[60vh] items-center justify-center">
        <div className="panel max-w-md p-8 text-center">
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "rgba(var(--posh-wash-rgb),0.08)" }}
          >
            <Sparkles className="h-6 w-6 text-[color:var(--posh-fg)]" aria-hidden="true" />
          </div>
          <h1 className="posh-page-title mt-4 text-xl">Sign in to use the AI Sourcing Assistant</h1>
          <p className="posh-subtitle mt-2">
            Tell us what material you need and we&apos;ll find the best sourcing option for you.
            Sign in to start a sourcing request and track it end to end.
          </p>
          <Link
            href="/auth/login?callbackUrl=/sourcing"
            className="posh-btn-solid mt-6 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Sign in to continue
          </Link>
        </div>
      </div>
    );
  }

  // Signed in: render the real assistant directly. The old page-level
  // "Sourcing desk / AI Sourcing Assistant" header has been removed — it
  // only repeated what SourcingAssistant's own composer ("What material are
  // you looking for?") already says, so the working surface now starts
  // immediately without a redundant title above it.
  return (
    <div className="posh-body">
      <SourcingAssistant />
    </div>
  );
}
