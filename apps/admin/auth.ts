import { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = (user as any).role || "ADMIN";
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        (session.user as any).role = token.role as string;
      }
      return session;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
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
  ],
};
