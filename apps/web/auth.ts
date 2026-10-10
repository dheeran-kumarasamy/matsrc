import NextAuth, { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { resolveBuilderGoogleSignIn } from "@/lib/google-identity";

export const authConfig: NextAuthConfig = {

  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "matsrc-web-dev-secret",
  pages: {
    signIn: "/auth/login",
    error: "/auth/login",
  },
  callbacks: {
    // Unified Account Identity: the audit found Buyer's Google login had NO
    // durable User provisioning/linking callback at all — Google sign-ins
    // never resolved to a database `User` row, unlike Supplier's (unsafe,
    // email-only) upsert. This adds the missing callback using the SAME
    // safe, AuthIdentity-based resolution Supplier now uses: the Google
    // identity key is the stable OAuth subject (account.providerAccountId),
    // never the Google email, and a real email that happens to match an
    // existing User is used ONLY as a link candidate — never to silently
    // merge with a different, already-linked User.
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const result = await resolveBuilderGoogleSignIn(user, account);
        if (!result.allow) {
          return result.redirectTo ?? false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = (user as any).role || "BUILDER";
        token.phone = (user as any).phone;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
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
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        phone: { label: "Phone", type: "tel" },
        name: { label: "Name", type: "text" },
        role: { label: "Role", type: "text" },
      },
      async authorize(credentials: any) {
        // For now, accept any credentials (dev mode)
        // In production, validate against API or database
        if (!credentials?.email) return null;

        return {
          id: credentials.email as string,
          email: credentials.email as string,
          name: (credentials.name as string) || "",
          image: null,
        } as any;
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      allowDangerousEmailAccountLinking: true,
      // Without this, Google silently reuses the browser's existing Google
      // session and signs the user straight into whichever account was last
      // active, never showing the account chooser — surprising when a buyer
      // has multiple Google accounts (e.g. personal + work). `select_account`
      // forces Google's account-chooser screen on every sign-in attempt, even
      // if the browser already has an active Google session.
      authorization: {
        params: { prompt: "select_account" },
      },
    }),
  ],
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);

