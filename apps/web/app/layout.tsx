import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { auth } from "@/auth";


const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Buildohub.in", template: "%s | Buildohub.in" },
  description: "India's B2B construction material procurement marketplace",
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
      <body className={`${inter.className} overflow-x-hidden`}>
        <AuthProvider session={session}>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
