import NextAuth from "next-auth";
import { authConfig } from "@/auth";

export const { GET, POST } = NextAuth(authConfig).handlers;
