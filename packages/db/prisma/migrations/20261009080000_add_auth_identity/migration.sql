-- Unified Account Identity — AuthIdentity table (additive only).
--
-- Adds the persistent identity-linking layer described in the identity
-- audit: WhatsApp OTP, Email OTP, and Google each resolve/create their own
-- User row independently today (no shared lookup), which can produce
-- duplicate accounts for the same real person within a single portal. This
-- migration only creates a new enum + a new table + indexes/FK — it does
-- NOT alter, drop, or backfill any existing column, table, row, or
-- constraint. The existing `User.email` unique constraint and the
-- intentionally-non-unique `User.phone` (see migration
-- 20261008130000_drop_user_phone_unique) are both left completely
-- untouched.
--
-- Uniqueness is scoped to (provider, providerIdentifier, role) rather than
-- a bare (provider, providerIdentifier) — this is the deliberate correction
-- noted in the schema's AuthIdentity doc comment: Buildohub intentionally
-- allows the SAME phone/email/Google identity to belong to one Buyer
-- (role=BUILDER) User and one Supplier (role=SUPPLIER) User simultaneously,
-- so role must be part of the uniqueness key, not just the provider +
-- identifier pair.
--
-- Backfilling AuthIdentity rows for pre-existing Users is handled by a
-- separate, idempotent, read-then-write script
-- (packages/db/scripts/backfill-auth-identities.js) run AFTER this
-- migration is applied — never as part of this migration file itself, so
-- the schema change and the data backfill remain independently reviewable
-- and independently re-runnable.

-- CreateEnum
CREATE TYPE "AuthIdentityProvider" AS ENUM ('WHATSAPP', 'EMAIL', 'GOOGLE');

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthIdentityProvider" NOT NULL,
    "providerIdentifier" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerIdentifier_role_key" ON "AuthIdentity"("provider", "providerIdentifier", "role");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
