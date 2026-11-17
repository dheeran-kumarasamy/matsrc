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
  googleAccount: { providerAccountId?: string | null } | null | undefined,
  googleProfile?: { sub?: string | null; email?: string | null; name?: string | null } | null | undefined
): Promise<GoogleSignInResult> {
  const providerAccountId = googleAccount?.providerAccountId || googleProfile?.sub;
  const rawEmail = googleUser.email || googleProfile?.email;
  const email = rawEmail ? rawEmail.trim().toLowerCase() : null;

  if (!providerAccountId || !email) {
    console.error("[auth:resolveSupplierGoogleSignIn] Missing providerAccountId or email:", {
      hasAccount: !!googleAccount,
      providerAccountId,
      email,
    });
    return { allow: false };
  }

  const scope = {
    provider: "GOOGLE" as const,
    providerIdentifier: providerAccountId,
    role: "SUPPLIER" as const,
  };

  try {
    // CRITICAL: `User.email` is globally unique across ALL roles, so a
    // matching User might actually be a Buyer (role=BUILDER), not a Supplier
    // — this role check is what prevents a Supplier Google login from ever
    // resolving to a Buyer's User (portal/role isolation).
    const emailMatch = await prisma.user.findUnique({ where: { email } });
    const emailCandidate = emailMatch?.role === "SUPPLIER" ? emailMatch : null;

    const conflict = await detectCrossIdentityConflict(prisma as any, scope, emailCandidate?.id ?? null);
    if (conflict) {
      console.warn("[auth:resolveSupplierGoogleSignIn] Cross identity conflict:", conflict);
      return { allow: false, redirectTo: `/sign-in?error=${conflict.code}` };
    }

    await resolveOrLinkIdentity(prisma as any, scope, {
      candidateUserId: emailCandidate?.id ?? null,
      createUser: async () => {
        const safeEmail = await resolveCrossRoleSafeEmail(prisma as any, email, "SUPPLIER");
        const created = await prisma.user.create({
          data: {
            email: safeEmail,
            name: googleUser.name || googleProfile?.name || null,
            role: "SUPPLIER",
            supplierProfile: {
              create: { companyName: googleUser.name || googleProfile?.name || "New Supplier" },
            },
          },
        });
        return { id: created.id };
      },
    });

    return { allow: true };
  } catch (error: any) {
    console.error("[auth:resolveSupplierGoogleSignIn] Database error during identity resolution:", error);
    return { allow: false, redirectTo: "/sign-in?error=Configuration" };
  }
}
