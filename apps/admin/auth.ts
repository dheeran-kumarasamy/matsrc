import NextAuth, { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@matsrc/db";
import { allMenus, DEFAULT_ADMIN_MENUS } from "@/lib/rbac";
import { verifyPassword } from "@/lib/password";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = (user as any).role || "ADMIN";
        token.name = user.name;
        token.menus = (user as any).menus || DEFAULT_ADMIN_MENUS;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string;
        session.user.email = token.email as string;
        (session.user as any).role = token.role as string;
        (session.user as any).menus = (token.menus as string[]) || DEFAULT_ADMIN_MENUS;
      }
      return session;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || "").trim().toLowerCase();
        const password = String(credentials?.password || "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            adminCredential: true,
            adminMenuPermissions: true,
          },
        });

        if (!user?.adminCredential) return null;
        if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") return null;

        const isValidPassword = await verifyPassword(password, user.adminCredential.passwordHash);
        if (!isValidPassword) return null;

        const menus =
          user.role === "SUPER_ADMIN"
            ? allMenus()
            : user.adminMenuPermissions.map((item) => item.menu);

        return {
          id: user.id,
          email: user.email,
          name: user.name || user.email,
          role: user.role,
          menus: menus.length > 0 ? menus : DEFAULT_ADMIN_MENUS,
          image: null,
        } as any;
      },
    }),
  ],
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
