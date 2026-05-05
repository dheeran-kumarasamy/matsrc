import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";

const manrope = Manrope({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "BuildMart Supplier", template: "%s | BuildMart Supplier" },
  description: "Supplier portal for onboarding, listings, and order fulfilment",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={manrope.className}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}