-- CreateTable
CREATE TABLE "CartIdempotency" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL DEFAULT 200,
    "responsePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "CartIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CartIdempotency_userId_key_key" ON "CartIdempotency"("userId", "key");

-- CreateIndex
CREATE INDEX "CartIdempotency_userId_idx" ON "CartIdempotency"("userId");

-- CreateIndex
CREATE INDEX "CartIdempotency_expiresAt_idx" ON "CartIdempotency"("expiresAt");

-- AddForeignKey
ALTER TABLE "CartIdempotency" ADD CONSTRAINT "CartIdempotency_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

