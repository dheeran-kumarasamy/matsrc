"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

// BUG-07 fix: previously this never received a `session` prop, so every
// page started as `status === "loading"` on first paint (even for an
// already-authenticated visitor) until the client re-fetched the session
// from `/api/auth/session`. Session-gated UI (e.g. SiteHeader's guest CTA)
// that didn't explicitly handle the "loading" state would render the guest
// CTA by default during that window. Accepting a server-fetched `session`
// here (see app/layout.tsx, which calls `auth()`) lets next-auth hydrate
// `useSession()` with the correct status immediately on first load.
export function AuthProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}

