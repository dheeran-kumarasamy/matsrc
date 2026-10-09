// Tests for apps/web/lib/google-identity.ts's resolveBuilderGoogleSignIn —
// Unified Account Identity. Prisma and the identity-resolution layer are
// mocked (same pattern as apps/supplier's google-identity.spec.ts); no
// real database/network calls. The audit found Buyer's Google login had NO
// durable User provisioning/linking at all — these tests cover the newly
// added behavior.

import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const userCreate = vi.fn();

const detectCrossIdentityConflict = vi.fn(async (..._args: any[]) => null as any);
const resolveOrLinkIdentity = vi.fn(async (_prisma: any, _scope: any, options: any) => {
  if (options.candidateUserId) return { status: "LINKED_EXISTING", userId: options.candidateUserId };
  const user = await options.createUser();
  return { status: "CREATED_NEW", userId: user.id };
});
const resolveCrossRoleSafeEmail = vi.fn(async (_prisma: any, email: string, ..._rest: any[]) => email);

vi.mock("@matsrc/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      create: (...args: unknown[]) => userCreate(...args),
    },
  },
  detectCrossIdentityConflict: (...args: unknown[]) => detectCrossIdentityConflict(...(args as [any, any, any])),
  resolveOrLinkIdentity: (...args: unknown[]) => resolveOrLinkIdentity(...(args as [any, any, any])),
  resolveCrossRoleSafeEmail: (...args: unknown[]) => resolveCrossRoleSafeEmail(...(args as [any, any, any])),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function googleAccount(providerAccountId = "google-sub-123") {
  return { providerAccountId };
}

describe("resolveBuilderGoogleSignIn — Unified Account Identity", () => {
  it("creates a new BUILDER User for a first-time Google identity (fixes the audit's missing-callback gap)", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "buyer-user-1" });

    const result = await resolveBuilderGoogleSignIn(
      { email: "new.buyer@example.com", name: "New Buyer" },
      googleAccount("sub-new")
    );

    expect(result).toEqual({ allow: true });
    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: "GOOGLE", providerIdentifier: "sub-new", role: "BUILDER" }),
      expect.objectContaining({ candidateUserId: null })
    );
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "BUILDER" }) })
    );
  });

  it("links to the existing BUILDER User when the Google email already belongs to one (Situation 1)", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue({ id: "buyer-user-existing", role: "BUILDER" });

    const result = await resolveBuilderGoogleSignIn(
      { email: "existing.buyer@example.com", name: "Existing" },
      googleAccount("sub-existing")
    );

    expect(result).toEqual({ allow: true });
    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ candidateUserId: "buyer-user-existing" })
    );
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("NEVER uses a SUPPLIER User with a matching email as a link candidate — portal/role isolation", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue({ id: "supplier-user-1", role: "SUPPLIER" });
    userCreate.mockResolvedValue({ id: "buyer-user-new" });

    await resolveBuilderGoogleSignIn({ email: "shared@example.com", name: "Shared Person" }, googleAccount("sub-shared"));

    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ candidateUserId: null })
    );
  });

  it("surfaces a safe conflict instead of silently merging when the Google identity already belongs to a DIFFERENT User", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue({ id: "user-B", role: "BUILDER" });
    detectCrossIdentityConflict.mockResolvedValue({ code: "IDENTITY_CONFLICT", message: "conflict" });

    const result = await resolveBuilderGoogleSignIn({ email: "conflicted@example.com", name: "Conflicted" }, googleAccount("sub-conflict"));

    expect(result).toEqual({ allow: false, redirectTo: "/auth/login?error=IDENTITY_CONFLICT" });
    expect(resolveOrLinkIdentity).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("rejects Google sign-in when no providerAccountId is present", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    const result = await resolveBuilderGoogleSignIn({ email: "no-sub@example.com" }, { providerAccountId: null });

    expect(result).toEqual({ allow: false });
    expect(resolveOrLinkIdentity).not.toHaveBeenCalled();
  });

  it("rejects Google sign-in when the Google profile has no email", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    const result = await resolveBuilderGoogleSignIn({ email: null }, googleAccount("sub-no-email"));

    expect(result).toEqual({ allow: false });
    expect(resolveOrLinkIdentity).not.toHaveBeenCalled();
  });
});
