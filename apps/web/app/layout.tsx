import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { auth } from "@/auth";

// Typography is intentionally centralised in app/globals.css (Inter for both
// body copy and headings, loaded via the Google Fonts import there) so the
// whole product — Home and the application — renders one consistent modern
// sans-serif type system rather than forking per surface.

// P2-D — root/homepage metadata. Route-level `generateMetadata`/`metadata`
// exports (products catalogue, category filter, PDP, price report) override
// title/description/canonical/robots per-route via Next's metadata merging;
// this stays the site-wide default/fallback and homepage copy.
export const metadata: Metadata = {
  title: { default: "Buildohub.in", template: "%s | Buildohub.in" },
  description:
    "Buildohub — India's B2B construction material procurement marketplace. Compare live prices from verified suppliers for cement, TMT bars, and more.",
  manifest: "/manifest.json",
  themeColor: "#1a4f8a",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Buildohub.in" },
  other: { "mobile-web-app-capable": "yes" },
};

// BUG-07 fix: server-fetching the session here (instead of leaving
// AuthProvider's SessionProvider with no initial value) means
// `useSession()` resolves to the correct authenticated/unauthenticated
// status on the very first render everywhere in the app, including the
// marketing homepage's SiteHeader — eliminating the guest-CTA flash for
// already-logged-in visitors on first load.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body className="overflow-x-hidden">
        <AuthProvider session={session}>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
