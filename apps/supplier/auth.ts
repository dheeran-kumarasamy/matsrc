import NextAuth from "next-auth";
import type { NextAuthConfig, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import { prisma } from "@matsrc/db";

const authConfig: NextAuthConfig = {
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
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      allowDangerousEmailAccountLinking: true,
    }),
  ],
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
