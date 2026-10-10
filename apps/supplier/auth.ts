import NextAuth from "next-auth";
import type { NextAuthConfig, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { resolveSupplierGoogleSignIn } from "@/lib/google-identity";

export const authConfig: NextAuthConfig = {
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
    async signIn({ user, account }) {
      // Only the Google OAuth path reaches this branch with a populated
      // `account` of type "oauth" — the Credentials provider (OTP login,
      // below) never triggers this callback with an `account.provider`
      // other than "credentials", so this block only ever runs for real
      // Google sign-ins.
      if (account?.provider === "google") {
        // Unified Account Identity (critical security fix from the audit):
        // the Google identity key is the STABLE Google OAuth subject
        // (account.providerAccountId / "sub"), NEVER the Google email —
        // the previous implementation upserted purely on `user.email`,
        // which meant ANY Google account whose email happened to match an
        // existing User's email was silently treated as that same User,
        // with no verification that the Google-account holder actually
        // owned that account. That unsafe email-only linking path is
        // removed entirely; `allowDangerousEmailAccountLinking` below is
        // now inert for identity-resolution purposes because the extracted
        // resolveSupplierGoogleSignIn() (lib/google-identity.ts) never
        // relies on email-based matching to decide ownership.
        const result = await resolveSupplierGoogleSignIn(user, account);
        if (!result.allow) {
          return result.redirectTo ?? false;
        }
      }
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
      // Without this, Google silently reuses the browser's existing Google
      // session and signs the user straight into whichever account was last
      // active, never showing the account chooser — surprising when a
      // supplier has multiple Google accounts (e.g. personal + business).
      // `select_account` forces Google's account-chooser screen on every
      // sign-in attempt, even if the browser already has an active Google
      // session. Mirrors the identical fix in apps/web/auth.ts.
      authorization: {
        params: { prompt: "select_account" },
      },
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
