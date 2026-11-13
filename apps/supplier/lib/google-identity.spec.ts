// Tests for apps/supplier/auth.ts's Google signIn callback — Unified
// Account Identity. Prisma and the identity-resolution layer are mocked
// (same pattern as otp-routes.spec.ts); no real database/network calls.
// Placed under lib/ to match this project's vitest.config.ts include
// pattern ("lib/**/*.spec.ts").

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
  return { provider: "google", providerAccountId, type: "oauth" };
}

describe("resolveSupplierGoogleSignIn — Unified Account Identity", () => {
  it("creates a new SUPPLIER User + SupplierProfile for a first-time Google identity", async () => {
    const { resolveSupplierGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "sup-user-1" });

    const result = await resolveSupplierGoogleSignIn(
      { email: "new.supplier@example.com", name: "New Supplier" },
      googleAccount("sub-new")
    );

    expect(result).toEqual({ allow: true });
    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: "GOOGLE", providerIdentifier: "sub-new", role: "SUPPLIER" }),
      expect.objectContaining({ candidateUserId: null })
    );
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "SUPPLIER" }) })
    );
  });

  it("links to the existing SUPPLIER User when the Google email already belongs to one (Situation 1)", async () => {
    const { resolveSupplierGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue({ id: "sup-user-existing", role: "SUPPLIER" });

    const result = await resolveSupplierGoogleSignIn(
      { email: "existing.supplier@example.com", name: "Existing" },
      googleAccount("sub-existing")
    );

    expect(result).toEqual({ allow: true });
    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ candidateUserId: "sup-user-existing" })
    );
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("NEVER uses a BUILDER (Buyer) User with a matching email as a link candidate — portal/role isolation", async () => {
    const { resolveSupplierGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue({ id: "buyer-user-1", role: "BUILDER" });
    userCreate.mockResolvedValue({ id: "sup-user-new" });

    await resolveSupplierGoogleSignIn({ email: "shared@example.com", name: "Shared Person" }, googleAccount("sub-shared"));

    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ candidateUserId: null })
    );
  });

  it("surfaces a safe conflict instead of silently merging when the Google identity already belongs to a DIFFERENT User", async () => {
    const { resolveSupplierGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue({ id: "user-B", role: "SUPPLIER" });
    detectCrossIdentityConflict.mockResolvedValue({ code: "IDENTITY_CONFLICT", message: "conflict" });

    const result = await resolveSupplierGoogleSignIn({ email: "conflicted@example.com", name: "Conflicted" }, googleAccount("sub-conflict"));

    expect(result).toEqual({ allow: false, redirectTo: "/sign-in?error=IDENTITY_CONFLICT" });
    expect(resolveOrLinkIdentity).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("rejects Google sign-in when no providerAccountId is present", async () => {
    const { resolveSupplierGoogleSignIn } = await import("./google-identity");
    const result = await resolveSupplierGoogleSignIn({ email: "no-sub@example.com" }, { providerAccountId: null });

    expect(result).toEqual({ allow: false });
    expect(resolveOrLinkIdentity).not.toHaveBeenCalled();
  });

  it("rejects Google sign-in when the Google profile has no email", async () => {
    const { resolveSupplierGoogleSignIn } = await import("./google-identity");
    const result = await resolveSupplierGoogleSignIn({ email: null }, googleAccount("sub-no-email"));

    expect(result).toEqual({ allow: false });
    expect(resolveOrLinkIdentity).not.toHaveBeenCalled();
  });
});
