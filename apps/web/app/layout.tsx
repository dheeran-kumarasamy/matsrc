import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import GlobalLoadingOverlay from "@/components/ui/GlobalLoadingOverlay";
import NavigationLoadingListener from "@/components/ui/NavigationLoadingListener";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Buildohub.in", template: "%s | Buildohub.in" },
  description: "India's B2B construction material procurement marketplace",
  manifest: "/manifest.json",
  themeColor: "#1a4f8a",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Buildohub.in" },
  other: { "mobile-web-app-capable": "yes" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} overflow-x-hidden`}>
        <AuthProvider>
          <Suspense fallback={null}>
            <NavigationLoadingListener />
          </Suspense>
          <GlobalLoadingOverlay />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
