import {
  prisma,
  resolveOrLinkIdentity,
  detectCrossIdentityConflict,
  resolveCrossRoleSafeEmail,
  ensureAuthIdentityTable,
} from "@matsrc/db";

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
  googleAccount: { providerAccountId?: string | null } | null | undefined,
  googleProfile?: { sub?: string | null; email?: string | null; name?: string | null } | null | undefined
): Promise<GoogleSignInResult> {
  const providerAccountId = googleAccount?.providerAccountId || googleProfile?.sub;
  const rawEmail = googleUser.email || googleProfile?.email;
  const email = rawEmail ? rawEmail.trim().toLowerCase() : null;

  if (!providerAccountId || !email) {
    console.error("[auth:resolveBuilderGoogleSignIn] Missing providerAccountId or email:", {
      hasAccount: !!googleAccount,
      providerAccountId,
      email,
    });
    return { allow: false };
  }

  const scope = {
    provider: "GOOGLE" as const,
    providerIdentifier: providerAccountId,
    role: "BUILDER" as const,
  };

  try {
    // CRITICAL: `User.email` is globally unique across BOTH portals/roles —
    // an email match might actually belong to a SUPPLIER, not a BUILDER
    // (portal/role isolation).
    const emailMatch = await prisma.user.findUnique({ where: { email } });
    const emailCandidate = emailMatch?.role === "BUILDER" ? emailMatch : null;

    try {
      const conflict = await detectCrossIdentityConflict(prisma as any, scope, emailCandidate?.id ?? null);
      if (conflict) {
        console.warn("[auth:resolveBuilderGoogleSignIn] Cross identity conflict:", conflict);
        return { allow: false, redirectTo: `/auth/login?error=${conflict.code}` };
      }

      await resolveOrLinkIdentity(prisma as any, scope, {
        candidateUserId: emailCandidate?.id ?? null,
        createUser: async () => {
          const safeEmail = await resolveCrossRoleSafeEmail(prisma as any, email, "BUILDER");
          const created = await prisma.user.create({
            data: {
              email: safeEmail,
              name: googleUser.name || googleProfile?.name || null,
              role: "BUILDER",
            },
          });
          return { id: created.id };
        },
      });

      return { allow: true };
    } catch (identityError: any) {
      // Self-heal: If AuthIdentity table is missing in the current database,
      // provision it automatically via idempotent DDL and retry.
      const isMissingTable =
        identityError?.code === "P2021" ||
        String(identityError?.message).includes("AuthIdentity") ||
        String(identityError?.message).includes("does not exist");

      if (isMissingTable) {
        console.warn("[auth:resolveBuilderGoogleSignIn] AuthIdentity table missing. Attempting automatic self-healing DDL...");
        const tableCreated = await ensureAuthIdentityTable(prisma);
        if (tableCreated) {
          await resolveOrLinkIdentity(prisma as any, scope, {
            candidateUserId: emailCandidate?.id ?? null,
            createUser: async () => {
              const safeEmail = await resolveCrossRoleSafeEmail(prisma as any, email, "BUILDER");
              const created = await prisma.user.create({
                data: {
                  email: safeEmail,
                  name: googleUser.name || googleProfile?.name || null,
                  role: "BUILDER",
                },
              });
              return { id: created.id };
            },
          });
          return { allow: true };
        }

        // Resilient fallback: If DDL execution is restricted, provision/reuse the BUILDER User row directly
        console.warn("[auth:resolveBuilderGoogleSignIn] Table self-heal unavailable, falling back to direct User resolution");
        if (!emailCandidate) {
          const safeEmail = await resolveCrossRoleSafeEmail(prisma as any, email, "BUILDER");
          await prisma.user.create({
            data: {
              email: safeEmail,
              name: googleUser.name || googleProfile?.name || null,
              role: "BUILDER",
            },
          });
        }
        return { allow: true };
      }

      throw identityError;
    }
  } catch (error: any) {
    console.error("[auth:resolveBuilderGoogleSignIn] Database error during identity resolution:", error);
    const reason = encodeURIComponent(error?.message || error?.name || String(error));
    return { allow: false, redirectTo: `/auth/login?error=Configuration&reason=${reason}` };
  }
}
