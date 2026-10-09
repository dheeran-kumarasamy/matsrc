import { prisma, resolveOrLinkIdentity, detectCrossIdentityConflict, resolveCrossRoleSafeEmail } from "@matsrc/db";

// Unified Account Identity — Buyer Google sign-in resolution, extracted out
// of apps/web/auth.ts's `signIn` callback into a plain, NextAuth-
// independent function so it can be unit-tested directly (the `next-auth`
// package's NextAuth() factory cannot be imported cleanly in this repo's
// Vitest environment). Mirrors apps/supplier/lib/google-identity.ts
// exactly, adapted to role=BUILDER.
//
// See packages/db/lib/identity-resolution.ts for the full identity-model
// rationale (stable Google `sub` as the identity key, never the email;
// never silently merging two distinct Users).
export type GoogleSignInResult =
  | { allow: true }
  | { allow: false; redirectTo?: string };

export async function resolveBuilderGoogleSignIn(
  googleUser: { email?: string | null; name?: string | null },
  googleAccount: { providerAccountId?: string | null } | null | undefined
): Promise<GoogleSignInResult> {
  if (!googleAccount?.providerAccountId || !googleUser.email) {
    return { allow: false };
  }

  const scope = {
    provider: "GOOGLE" as const,
    providerIdentifier: googleAccount.providerAccountId,
    role: "BUILDER" as const,
  };

  // CRITICAL: `User.email` is globally unique across BOTH portals/roles —
  // an email match might actually belong to a SUPPLIER, not a BUILDER
  // (portal/role isolation).
  const emailMatch = await prisma.user.findUnique({ where: { email: googleUser.email } });
  const emailCandidate = emailMatch?.role === "BUILDER" ? emailMatch : null;

  const conflict = await detectCrossIdentityConflict(prisma as any, scope, emailCandidate?.id ?? null);
  if (conflict) {
    return { allow: false, redirectTo: `/auth/login?error=${conflict.code}` };
  }

  await resolveOrLinkIdentity(prisma as any, scope, {
    candidateUserId: emailCandidate?.id ?? null,
    createUser: async () => {
      const safeEmail = await resolveCrossRoleSafeEmail(prisma as any, googleUser.email as string, "BUILDER");
      const created = await prisma.user.create({
        data: {
          email: safeEmail,
          name: googleUser.name ?? null,
          role: "BUILDER",
        },
      });
      return { id: created.id };
    },
  });

  return { allow: true };
}
