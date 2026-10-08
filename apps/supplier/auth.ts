import NextAuth from "next-auth";
import type { NextAuthConfig, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@matsrc/db";

const authConfig: NextAuthConfig = {
  // Matches the same pattern used in apps/web/auth.ts and apps/admin/auth.ts.
  // NextAuth v5 auto-detects `process.env.AUTH_SECRET`, but if that env var
  // isn't set in a deployment's environment (e.g. a UAT/preview environment
  // where it was never configured), auth.js throws a generic "Configuration"
  // error on every /api/auth/session call. Setting `secret` explicitly with a
  // safe fallback keeps local/dev/preview environments from hard-failing while
  // still respecting a real secret whenever one is configured.
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "matsrc-supplier-dev-secret",
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      // Auto-provision User + SupplierProfile on first Google sign-in
      await prisma.user.upsert({
        where: { email: user.email },
        update: {},
        create: {
          email: user.email,
          name: user.name ?? null,
          role: "SUPPLIER",
          supplierProfile: {
            create: { companyName: user.name ?? "New Supplier" },
          },
        },
      });
      return true;
    },
    async jwt({ token, user }): Promise<JWT> {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = (user as any).role || "SUPPLIER";
        token.phone = (user as any).phone;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }): Promise<Session> {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        (session.user as any).role = token.role as string;
        (session.user as any).phone = token.phone as string;
      }
      return session;
    },
  },
  providers: [
    // UNCHANGED: Google provider, config, and the signIn()/jwt()/session()
    // callbacks above are exactly as they were before this change — the new
    // OTP login path (Credentials provider below) is additive only.
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      allowDangerousEmailAccountLinking: true,
    }),
    // New: Supplier OTP login (WhatsApp primary / email fallback). This
    // provider does NOT perform OTP verification itself — by the time this
    // `authorize()` runs, the Supplier's new /api/auth/send-otp +
    // /api/auth/verify-otp routes (apps/supplier/lib/otp-service/) have
    // already verified the OTP against the shared OtpChallenge lifecycle
    // (packages/db/lib/otp-challenge.ts) and resolved/created the
    // SupplierProfile-bearing User row. This Credentials provider's sole
    // job is to mint the same NextAuth session shape Google login produces,
    // using the already-verified email — mirroring apps/web/auth.ts's
    // identical "accept pre-verified identity" Credentials provider.
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        name: { label: "Name", type: "text" },
      },
      async authorize(credentials: any) {
        if (!credentials?.email) return null;
        return {
          id: credentials.email as string,
          email: credentials.email as string,
          name: (credentials.name as string) || "",
          image: null,
        } as any;
      },
    }),
  ],
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
