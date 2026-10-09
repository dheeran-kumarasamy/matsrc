import { prisma, resolveOrLinkIdentity, detectCrossIdentityConflict, resolveCrossRoleSafeEmail } from "@matsrc/db";

// Unified Account Identity — Supplier Google sign-in resolution, extracted
// out of apps/supplier/auth.ts's `signIn` callback into a plain,
// NextAuth-independent function so it can be unit-tested directly (the
// `next-auth` package's NextAuth() factory cannot be imported cleanly in
// this repo's Vitest environment — see lib/google-signin.spec.ts for the
// same limitation already documented elsewhere in this repo's auth code).
//
// See packages/db/lib/identity-resolution.ts for the full identity-model
// rationale (stable Google `sub` as the identity key, never the email;
// never silently merging two distinct Users).
export type GoogleSignInResult =
  | { allow: true }
  | { allow: false; redirectTo?: string };

export async function resolveSupplierGoogleSignIn(
  googleUser: { email?: string | null; name?: string | null },
  googleAccount: { providerAccountId?: string | null } | null | undefined
): Promise<GoogleSignInResult> {
  if (!googleAccount?.providerAccountId || !googleUser.email) {
    return { allow: false };
  }

  const scope = {
    provider: "GOOGLE" as const,
    providerIdentifier: googleAccount.providerAccountId,
    role: "SUPPLIER" as const,
  };

  // CRITICAL: `User.email` is globally unique across ALL roles, so a
  // matching User might actually be a Buyer (role=BUILDER), not a Supplier
  // — this role check is what prevents a Supplier Google login from ever
  // resolving to a Buyer's User (portal/role isolation).
  const emailMatch = await prisma.user.findUnique({ where: { email: googleUser.email } });
  const emailCandidate = emailMatch?.role === "SUPPLIER" ? emailMatch : null;

  const conflict = await detectCrossIdentityConflict(prisma as any, scope, emailCandidate?.id ?? null);
  if (conflict) {
    return { allow: false, redirectTo: `/sign-in?error=${conflict.code}` };
  }

  await resolveOrLinkIdentity(prisma as any, scope, {
    candidateUserId: emailCandidate?.id ?? null,
    createUser: async () => {
      const safeEmail = await resolveCrossRoleSafeEmail(prisma as any, googleUser.email as string, "SUPPLIER");
      const created = await prisma.user.create({
        data: {
          email: safeEmail,
          name: googleUser.name ?? null,
          role: "SUPPLIER",
          supplierProfile: {
            create: { companyName: googleUser.name ?? "New Supplier" },
          },
        },
      });
      return { id: created.id };
    },
  });

  return { allow: true };
}
