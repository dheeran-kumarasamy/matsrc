// packages/db/lib/identity-resolution.ts
//
// Unified Account Identity — shared, framework-agnostic identity resolution
// used by every login method in every portal (Buyer WhatsApp/Email/Google,
// Supplier WhatsApp/Email/Google). This is the single place that decides
// "does this (provider, identifier, role) already map to a User, and if
// not, can a new identity be safely linked to one?" — see the identity
// audit this implements for full background.
//
// CORE INVARIANT: an authentication event NEVER silently merges two
// pre-existing, DIFFERENT Users. If the identifier being authenticated
// belongs to a different User than the one already resolved via another
// identity, this module returns a conflict result — it never reassigns
// data, deletes a User, or picks a "winner".
//
// Portal/role scoping: every lookup/link operation is scoped by `role`
// (BUILDER or SUPPLIER) in addition to `provider` + `providerIdentifier` —
// this is what allows the SAME phone/email/Google identity to resolve to
// one Buyer User AND one Supplier User without collision, while still
// guaranteeing one identity can only ever point at ONE User within a given
// role. See AuthIdentity's schema.prisma doc comment for the full
// rationale.
//
// This module never logs an OTP, access token, or Google token — only
// normalized identifiers (phone/email/Google sub) and User/AuthIdentity
// ids, which is consistent with every other OTP-adjacent module in this
// repo (see packages/db/lib/otp-challenge.ts).

export type IdentityResolutionPrismaClient = {
  authIdentity: {
    findUnique: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
  user: {
    findUnique: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
  $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
};

export type AuthIdentityProviderName = "WHATSAPP" | "EMAIL" | "GOOGLE";

export type IdentityScope = {
  provider: AuthIdentityProviderName;
  providerIdentifier: string;
  role: "BUILDER" | "SUPPLIER";
};

/**
 * Looks up an existing AuthIdentity for `scope` and returns the User it
 * points at, if any. Returns `null` if no identity is linked yet — this is
 * NOT an error, it simply means the caller must decide (via
 * resolveOrLinkIdentity below) whether a new User should be created or an
 * existing one safely linked.
 */
export async function findIdentity(
  prisma: IdentityResolutionPrismaClient,
  scope: IdentityScope
): Promise<{ id: string; userId: string } | null> {
  const identity = await prisma.authIdentity.findUnique({
    where: {
      provider_providerIdentifier_role: {
        provider: scope.provider,
        providerIdentifier: scope.providerIdentifier,
        role: scope.role,
      },
    },
  });
  return identity ? { id: identity.id, userId: identity.userId } : null;
}

/**
 * Creates a new AuthIdentity row linking `scope` to `userId`. Idempotent:
 * if the identity already exists (e.g. a concurrent request raced this
 * call), the unique constraint violation (Prisma P2002) is swallowed and
 * the existing row is returned instead — running this twice, or two
 * requests running it concurrently, never creates a duplicate identity row
 * and never throws to the caller.
 */
export async function linkIdentity(
  prisma: IdentityResolutionPrismaClient,
  scope: IdentityScope,
  userId: string
): Promise<{ id: string; userId: string }> {
  try {
    const created = await prisma.authIdentity.create({
      data: {
        userId,
        provider: scope.provider,
        providerIdentifier: scope.providerIdentifier,
        role: scope.role,
      },
    });
    return { id: created.id, userId: created.userId };
  } catch (error: any) {
    // P2002 = unique constraint violation — another request already linked
    // this exact (provider, providerIdentifier, role) in the meantime.
    if (error?.code === "P2002") {
      const existing = await findIdentity(prisma, scope);
      if (existing) return existing;
    }
    throw error;
  }
}

export type ResolveIdentityResult =
  | { status: "LINKED_EXISTING"; userId: string }
  | { status: "CREATED_NEW"; userId: string };

/**
 * The central resolution algorithm used by every login route.
 *
 *   1. If `scope` already has a linked AuthIdentity, return its User
 *      (LINKED_EXISTING) — never creates another User.
 *   2. Otherwise, if `candidateUserId` is provided (e.g. the caller already
 *      found a pre-existing User by some OTHER signal, such as a legacy
 *      placeholder-email lookup or an already-authenticated session), link
 *      this identity to THAT User and return it as LINKED_EXISTING — this
 *      is "Situation 1" from the audit: one existing account gaining a new
 *      authentication method.
 *   3. Otherwise, call `createUser()` to provision a brand-new User, link
 *      the identity to it, and return CREATED_NEW.
 *
 * This function NEVER merges two already-distinct Users. If the caller
 * already knows of two different candidate Users for the same person
 * (e.g. one via phone, one via email, and they don't match), it must
 * surface that itself as a conflict BEFORE ever calling this function —
 * see detectCrossIdentityConflict() below, used by the route handlers for
 * exactly that check.
 */
export async function resolveOrLinkIdentity(
  prisma: IdentityResolutionPrismaClient,
  scope: IdentityScope,
  options: {
    /** A User already identified via another signal (e.g. legacy placeholder email, or an authenticated session) that this identity should be linked to if no AuthIdentity exists yet. */
    candidateUserId?: string | null;
    /** Called only when neither an existing AuthIdentity nor a candidateUserId resolves a User — provisions a genuinely new User (and e.g. SupplierProfile). */
    createUser: () => Promise<{ id: string }>;
  }
): Promise<ResolveIdentityResult> {
  const existing = await findIdentity(prisma, scope);
  if (existing) {
    return { status: "LINKED_EXISTING", userId: existing.userId };
  }

  if (options.candidateUserId) {
    await linkIdentity(prisma, scope, options.candidateUserId);
    return { status: "LINKED_EXISTING", userId: options.candidateUserId };
  }

  const user = await options.createUser();
  await linkIdentity(prisma, scope, user.id);
  return { status: "CREATED_NEW", userId: user.id };
}

export type UserEmailLookupPrismaClient = {
  user: { findUnique: (args: any) => Promise<any> };
};

/**
 * `User.email` is a pre-existing, globally-unique column (unchanged by this
 * migration — see schema.prisma) shared across BOTH portals/roles. This
 * means a real email address that already belongs to a User of the OTHER
 * role (e.g. a Buyer) cannot also be used verbatim as a brand-new
 * Supplier User's `email` — that would violate the existing unique
 * constraint. Rather than touching `User.email`'s uniqueness (explicitly
 * out of scope — "do NOT perform a broad application-wide email identity
 * refactor"), this derives a small, deterministic, still-recognizable
 * disambiguated email (`local+<role>@domain`) ONLY for the internal
 * `User.email` column in that specific cross-role-collision case. The
 * real email the person actually owns is still what's stored as the
 * EMAIL/GOOGLE AuthIdentity's `providerIdentifier` and is still what's
 * used for actual OTP delivery (see each portal's otp-service, which
 * always delivers to the normalized `identifier`, never to `User.email`).
 *
 * BUG FIX: the original implementation derived `local+<role>@domain` and
 * returned it WITHOUT verifying that derived address was itself actually
 * free. Caught in production: a Buyer (BUILDER) account was created via
 * Google sign-in at `dheeran.kumarasamy+builder@gmail.com` (the derived
 * email, because the real email already belonged to a SUPPLIER User).
 * Minutes later, an Email-OTP login attempt for the SAME real
 * (SUPPLIER-owned) email, also resolving role=BUILDER, re-derived that
 * EXACT SAME `+builder` address — which now already belonged to the
 * just-created BUILDER user — and `prisma.user.create()` threw a P2002
 * unique-constraint violation, surfaced to the end user as a generic
 * "verify-otp" 400. Fixed by looping with an incrementing numeric suffix
 * (`+builder`, `+builder2`, `+builder3`, ...) until a genuinely free email
 * is found, and by checking uniqueness even when no role-collision was
 * detected on the ORIGINAL desiredEmail (belt-and-suspenders: the original
 * early-return assumed "no existing user at this address" or "same role"
 * meant always safe, which holds for desiredEmail itself but not
 * necessarily indicative of race conditions — kept as the fast path, the
 * loop below is what actually guarantees the returned email is free).
 */
export async function resolveCrossRoleSafeEmail(
  prisma: UserEmailLookupPrismaClient,
  desiredEmail: string,
  role: "BUILDER" | "SUPPLIER"
): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: desiredEmail } });
  if (!existing || existing.role === role) {
    return desiredEmail;
  }

  const at = desiredEmail.indexOf("@");
  if (at <= 0) return desiredEmail;
  const local = desiredEmail.slice(0, at);
  const domain = desiredEmail.slice(at + 1);
  const suffixTag = role === "SUPPLIER" ? "supplier" : "builder";

  // Try `local+<role>@domain` first (the original, human-recognizable
  // scheme), then fall back to `local+<role>2@domain`, `+<role>3@domain`,
  // etc. until an address with no existing User row is found. A generous
  // but finite cap avoids ever looping forever if something is
  // pathologically wrong.
  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = attempt === 1 ? `${local}+${suffixTag}@${domain}` : `${local}+${suffixTag}${attempt}@${domain}`;
    const candidateExisting = await prisma.user.findUnique({ where: { email: candidate } });
    if (!candidateExisting) {
      return candidate;
    }
  }

  // Exhausted every attempt (should never happen in practice) — fail
  // loudly rather than silently returning a colliding email that would
  // just throw a confusing P2002 further down the call stack anyway.
  throw new Error("Could not derive a unique cross-role-safe email after 50 attempts.");
}

export type IdentityConflictError = {
  code: "IDENTITY_CONFLICT" | "ACCOUNT_LINK_REQUIRED";
  message: string;
};

/**
 * Detects "Situation 2" from the audit: the identifier being authenticated
 * (via `scope`) already has a linked AuthIdentity pointing at a DIFFERENT
 * User than `otherCandidateUserId` (a User already resolved through some
 * other signal in the same login attempt). Returns a conflict descriptor
 * if so — callers must surface this as a safe, generic failure and MUST
 * NOT attempt to merge, reassign, or delete either User.
 *
 * Returns `null` when there is no conflict (either no identity is linked
 * yet, or it already points at the same candidate User).
 */
export async function detectCrossIdentityConflict(
  prisma: IdentityResolutionPrismaClient,
  scope: IdentityScope,
  otherCandidateUserId: string | null | undefined
): Promise<IdentityConflictError | null> {
  if (!otherCandidateUserId) return null;
  const existing = await findIdentity(prisma, scope);
  if (existing && existing.userId !== otherCandidateUserId) {
    return {
      code: "IDENTITY_CONFLICT",
      message:
        "This identifier is already linked to a different account. Please sign in using the method you used originally, or contact support to link your accounts.",
    };
  }
  return null;
}
