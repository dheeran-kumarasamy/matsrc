import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  findIdentity,
  linkIdentity,
  resolveOrLinkIdentity,
  detectCrossIdentityConflict,
  type IdentityResolutionPrismaClient,
} from "./identity-resolution";

// Tests for the shared identity-resolution layer (AuthIdentity) backing
// WhatsApp OTP / Email OTP / Google login resolution in both portals.

function buildPrisma(): IdentityResolutionPrismaClient & {
  _findUnique: ReturnType<typeof vi.fn>;
  _findFirst: ReturnType<typeof vi.fn>;
  _create: ReturnType<typeof vi.fn>;
} {
  const findUnique = vi.fn();
  const findFirst = vi.fn();
  const create = vi.fn();
  return {
    authIdentity: { findUnique, findFirst, create },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({})),
    _findUnique: findUnique,
    _findFirst: findFirst,
    _create: create,
  } as any;
}

const SCOPE = { provider: "WHATSAPP" as const, providerIdentifier: "+919000000000", role: "BUILDER" as const };

describe("findIdentity", () => {
  it("returns null when no AuthIdentity exists for the scope", async () => {
    const prisma = buildPrisma();
    prisma._findUnique.mockResolvedValue(null);

    const result = await findIdentity(prisma, SCOPE);
    expect(result).toBeNull();
  });

  it("returns the linked userId when an AuthIdentity exists", async () => {
    const prisma = buildPrisma();
    prisma._findUnique.mockResolvedValue({ id: "ai-1", userId: "user-1" });

    const result = await findIdentity(prisma, SCOPE);
    expect(result).toEqual({ id: "ai-1", userId: "user-1" });
    expect(prisma._findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerIdentifier_role: {
          provider: "WHATSAPP",
          providerIdentifier: "+919000000000",
          role: "BUILDER",
        },
      },
    });
  });
});

describe("linkIdentity", () => {
  it("creates a new AuthIdentity row", async () => {
    const prisma = buildPrisma();
    prisma._create.mockResolvedValue({ id: "ai-1", userId: "user-1" });

    const result = await linkIdentity(prisma, SCOPE, "user-1");
    expect(result).toEqual({ id: "ai-1", userId: "user-1" });
    expect(prisma._create).toHaveBeenCalledWith({
      data: { userId: "user-1", provider: "WHATSAPP", providerIdentifier: "+919000000000", role: "BUILDER" },
    });
  });

  it("is idempotent: a P2002 race returns the already-created identity instead of throwing", async () => {
    const prisma = buildPrisma();
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma._create.mockRejectedValue(conflict);
    prisma._findUnique.mockResolvedValue({ id: "ai-1", userId: "user-1" });

    const result = await linkIdentity(prisma, SCOPE, "user-1");
    expect(result).toEqual({ id: "ai-1", userId: "user-1" });
  });

  it("re-throws non-P2002 errors", async () => {
    const prisma = buildPrisma();
    prisma._create.mockRejectedValue(new Error("boom"));

    await expect(linkIdentity(prisma, SCOPE, "user-1")).rejects.toThrow("boom");
  });
});

describe("resolveOrLinkIdentity", () => {
  it("returns LINKED_EXISTING and never creates a User when the identity is already linked", async () => {
    const prisma = buildPrisma();
    prisma._findUnique.mockResolvedValue({ id: "ai-1", userId: "user-1" });
    const createUser = vi.fn();

    const result = await resolveOrLinkIdentity(prisma, SCOPE, { createUser });

    expect(result).toEqual({ status: "LINKED_EXISTING", userId: "user-1" });
    expect(createUser).not.toHaveBeenCalled();
    expect(prisma._create).not.toHaveBeenCalled();
  });

  it("links a new identity to a candidateUserId instead of creating a new User (Situation 1 — new method, existing account)", async () => {
    const prisma = buildPrisma();
    prisma._findUnique.mockResolvedValue(null);
    prisma._create.mockResolvedValue({ id: "ai-2", userId: "user-1" });
    const createUser = vi.fn();

    const result = await resolveOrLinkIdentity(prisma, SCOPE, { candidateUserId: "user-1", createUser });

    expect(result).toEqual({ status: "LINKED_EXISTING", userId: "user-1" });
    expect(createUser).not.toHaveBeenCalled();
    expect(prisma._create).toHaveBeenCalledWith({
      data: { userId: "user-1", provider: "WHATSAPP", providerIdentifier: "+919000000000", role: "BUILDER" },
    });
  });

  it("creates a brand-new User and links the identity when nothing resolves", async () => {
    const prisma = buildPrisma();
    prisma._findUnique.mockResolvedValue(null);
    prisma._create.mockResolvedValue({ id: "ai-3", userId: "new-user" });
    const createUser = vi.fn(async () => ({ id: "new-user" }));

    const result = await resolveOrLinkIdentity(prisma, SCOPE, { createUser });

    expect(result).toEqual({ status: "CREATED_NEW", userId: "new-user" });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(prisma._create).toHaveBeenCalledWith({
      data: { userId: "new-user", provider: "WHATSAPP", providerIdentifier: "+919000000000", role: "BUILDER" },
    });
  });
});

describe("detectCrossIdentityConflict", () => {
  it("returns null when there is no otherCandidateUserId to compare against", async () => {
    const prisma = buildPrisma();
    const result = await detectCrossIdentityConflict(prisma, SCOPE, null);
    expect(result).toBeNull();
    expect(prisma._findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the existing identity already points at the same candidate User", async () => {
    const prisma = buildPrisma();
    prisma._findUnique.mockResolvedValue({ id: "ai-1", userId: "user-1" });

    const result = await detectCrossIdentityConflict(prisma, SCOPE, "user-1");
    expect(result).toBeNull();
  });

  it("returns an IDENTITY_CONFLICT when the identity already belongs to a DIFFERENT User (Situation 2 — must never silently merge)", async () => {
    const prisma = buildPrisma();
    prisma._findUnique.mockResolvedValue({ id: "ai-1", userId: "user-B" });

    const result = await detectCrossIdentityConflict(prisma, SCOPE, "user-A");
    expect(result).toEqual({ code: "IDENTITY_CONFLICT", message: expect.any(String) });
  });

  it("returns null when no identity is linked yet at all", async () => {
    const prisma = buildPrisma();
    prisma._findUnique.mockResolvedValue(null);

    const result = await detectCrossIdentityConflict(prisma, SCOPE, "user-A");
    expect(result).toBeNull();
  });
});
