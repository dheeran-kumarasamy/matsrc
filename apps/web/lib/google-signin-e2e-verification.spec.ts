// Phase 5 End-to-End Scenarios Test Suite
// Verifies all 8 scenarios mandated by the task specification:
// 1. Existing Buyer Google account
// 2. Existing Supplier Google account
// 3. New permitted Google account
// 4. Google email with uppercase characters
// 5. Google authentication cancellation
// 6. Database connectivity failure simulation
// 7. Buyer account attempting Supplier authentication
// 8. Supplier account attempting Buyer authentication

import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const userCreate = vi.fn();
const authIdentityFindUnique = vi.fn();
const authIdentityCreate = vi.fn();

const detectCrossIdentityConflict = vi.fn(async (prisma: any, scope: any, candidateUserId: any) => {
  if (!candidateUserId) return null;
  const existing = await prisma.authIdentity.findUnique({
    where: {
      provider_providerIdentifier_role: {
        provider: scope.provider,
        providerIdentifier: scope.providerIdentifier,
        role: scope.role,
      },
    },
  });
  if (existing && existing.userId !== candidateUserId) {
    return {
      code: "IDENTITY_CONFLICT",
      message: "This identifier is already linked to a different account.",
    };
  }
  return null;
});

const resolveOrLinkIdentity = vi.fn(async (prisma: any, scope: any, options: any) => {
  const existing = await prisma.authIdentity.findUnique({
    where: {
      provider_providerIdentifier_role: {
        provider: scope.provider,
        providerIdentifier: scope.providerIdentifier,
        role: scope.role,
      },
    },
  });
  if (existing) {
    return { status: "LINKED_EXISTING", userId: existing.userId };
  }
  if (options.candidateUserId) {
    await prisma.authIdentity.create({
      data: {
        userId: options.candidateUserId,
        provider: scope.provider,
        providerIdentifier: scope.providerIdentifier,
        role: scope.role,
      },
    });
    return { status: "LINKED_EXISTING", userId: options.candidateUserId };
  }
  const user = await options.createUser();
  await prisma.authIdentity.create({
    data: {
      userId: user.id,
      provider: scope.provider,
      providerIdentifier: scope.providerIdentifier,
      role: scope.role,
    },
  });
  return { status: "CREATED_NEW", userId: user.id };
});

const resolveCrossRoleSafeEmail = vi.fn(async (prisma: any, email: string, role: string) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing || existing.role === role) return email;
  const [local, domain] = email.split("@");
  return `${local}+${role.toLowerCase()}@${domain}`;
});

vi.mock("@matsrc/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => userFindUnique(...args),
      create: (...args: any[]) => userCreate(...args),
    },
    authIdentity: {
      findUnique: (...args: any[]) => authIdentityFindUnique(...args),
      create: (...args: any[]) => authIdentityCreate(...args),
    },
  },
  detectCrossIdentityConflict: (...args: any[]) => (detectCrossIdentityConflict as any)(...args),
  resolveOrLinkIdentity: (...args: any[]) => (resolveOrLinkIdentity as any)(...args),
  resolveCrossRoleSafeEmail: (...args: any[]) => (resolveCrossRoleSafeEmail as any)(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Phase 5 — Google Sign-in End-to-End Scenarios", () => {
  // Scenario 1: Existing Buyer Google account
  it("Scenario 1: Existing Buyer Google account signs in and re-uses existing AuthIdentity", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue({ id: "buyer-existing-id", email: "buyer@example.com", role: "BUILDER" });
    authIdentityFindUnique.mockResolvedValue({ id: "auth-id-1", userId: "buyer-existing-id" });

    const result = await resolveBuilderGoogleSignIn(
      { email: "buyer@example.com", name: "Existing Buyer" },
      { providerAccountId: "sub-buyer-1" }
    );

    expect(result).toEqual({ allow: true });
    expect(userCreate).not.toHaveBeenCalled();
    expect(authIdentityCreate).not.toHaveBeenCalled();
  });

  // Scenario 2: Existing Supplier Google account
  it("Scenario 2: Existing Supplier Google account signs in to supplier portal", async () => {
    const { resolveSupplierGoogleSignIn } = await import("../../supplier/lib/google-identity");
    userFindUnique.mockResolvedValue({ id: "supplier-existing-id", email: "supplier@example.com", role: "SUPPLIER" });
    authIdentityFindUnique.mockResolvedValue({ id: "auth-id-2", userId: "supplier-existing-id" });

    const result = await resolveSupplierGoogleSignIn(
      { email: "supplier@example.com", name: "Existing Supplier" },
      { providerAccountId: "sub-supplier-1" }
    );

    expect(result).toEqual({ allow: true });
    expect(userCreate).not.toHaveBeenCalled();
    expect(authIdentityCreate).not.toHaveBeenCalled();
  });

  // Scenario 3: New permitted Google account
  it("Scenario 3: New permitted Google account creates a new User and AuthIdentity", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue(null);
    authIdentityFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "buyer-new-id", email: "newbuyer@example.com", role: "BUILDER" });
    authIdentityCreate.mockResolvedValue({ id: "auth-id-new", userId: "buyer-new-id" });

    const result = await resolveBuilderGoogleSignIn(
      { email: "newbuyer@example.com", name: "New Buyer" },
      { providerAccountId: "sub-new-buyer" }
    );

    expect(result).toEqual({ allow: true });
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "newbuyer@example.com", role: "BUILDER" }),
      })
    );
    expect(authIdentityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "buyer-new-id",
          provider: "GOOGLE",
          providerIdentifier: "sub-new-buyer",
          role: "BUILDER",
        }),
      })
    );
  });

  // Scenario 4: Google email with uppercase characters
  it("Scenario 4: Google email with uppercase characters is normalized to lowercase", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockResolvedValue({ id: "buyer-id", email: "cased.buyer@example.com", role: "BUILDER" });
    authIdentityFindUnique.mockResolvedValue({ id: "auth-id-cased", userId: "buyer-id" });

    const result = await resolveBuilderGoogleSignIn(
      { email: "  CASED.Buyer@Example.COM  ", name: "Cased Buyer" },
      { providerAccountId: "sub-cased" }
    );

    expect(result).toEqual({ allow: true });
    expect(userFindUnique).toHaveBeenCalledWith({ where: { email: "cased.buyer@example.com" } });
  });

  // Scenario 5: Google authentication cancellation / missing credentials
  it("Scenario 5: Missing credentials or user cancellation cleanly disallows sign-in", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");

    // Missing email
    const resNoEmail = await resolveBuilderGoogleSignIn(
      { email: null },
      { providerAccountId: "sub-123" }
    );
    expect(resNoEmail).toEqual({ allow: false });

    // Missing providerAccountId
    const resNoSub = await resolveBuilderGoogleSignIn(
      { email: "user@example.com" },
      { providerAccountId: null }
    );
    expect(resNoSub).toEqual({ allow: false });
  });

  // Scenario 6: Database connectivity failure simulation in a controlled test environment
  it("Scenario 6: Database connectivity failure redirects safely to ?error=Configuration", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    userFindUnique.mockRejectedValue(new Error("ConnectTimeoutError: Neon pooler connection timed out"));

    const result = await resolveBuilderGoogleSignIn(
      { email: "buyer@example.com", name: "Buyer" },
      { providerAccountId: "sub-timeout" }
    );

    expect(result).toEqual({ allow: false, redirectTo: "/auth/login?error=Configuration" });
  });

  // Scenario 7: Buyer account attempting Supplier authentication
  it("Scenario 7: Buyer account attempting Supplier authentication preserves role isolation and does not hijack buyer account", async () => {
    const { resolveSupplierGoogleSignIn } = await import("../../supplier/lib/google-identity");
    // Email matches a BUILDER user in the DB
    userFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.email === "shared@example.com") {
        return { id: "existing-buyer-user-id", email: "shared@example.com", role: "BUILDER" };
      }
      return null;
    });
    authIdentityFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "new-supplier-user-id", email: "shared+supplier@example.com", role: "SUPPLIER" });

    const result = await resolveSupplierGoogleSignIn(
      { email: "shared@example.com", name: "Cross Role User" },
      { providerAccountId: "sub-cross-role" }
    );

    expect(result).toEqual({ allow: true });
    // Candidate ID was NOT the buyer user ID:
    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "SUPPLIER" }),
      expect.objectContaining({ candidateUserId: null })
    );
    // Derived disambiguated email for Supplier:
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "shared+supplier@example.com",
          role: "SUPPLIER",
        }),
      })
    );
  });

  // Scenario 8: Supplier account attempting Buyer authentication
  it("Scenario 8: Supplier account attempting Buyer authentication preserves role isolation and does not hijack supplier account", async () => {
    const { resolveBuilderGoogleSignIn } = await import("./google-identity");
    // Email matches a SUPPLIER user in the DB
    userFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.email === "supplier@example.com") {
        return { id: "existing-supplier-user-id", email: "supplier@example.com", role: "SUPPLIER" };
      }
      return null;
    });
    authIdentityFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "new-buyer-user-id", email: "supplier+builder@example.com", role: "BUILDER" });

    const result = await resolveBuilderGoogleSignIn(
      { email: "supplier@example.com", name: "Cross Role User" },
      { providerAccountId: "sub-cross-role-2" }
    );

    expect(result).toEqual({ allow: true });
    // Candidate ID was NOT the supplier user ID:
    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "BUILDER" }),
      expect.objectContaining({ candidateUserId: null })
    );
    // Derived disambiguated email for Buyer:
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "supplier+builder@example.com",
          role: "BUILDER",
        }),
      })
    );
  });
});

