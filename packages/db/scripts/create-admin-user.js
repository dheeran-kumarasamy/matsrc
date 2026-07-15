// packages/db/scripts/create-admin-user.js
//
// One-off script: creates (or updates) a SUPER_ADMIN user + AdminCredential for
// logging into the admin portal (apps/admin), using the same scrypt-based password
// hashing scheme as apps/admin/lib/password.ts (salt:hashHex, scrypt with 64-byte
// key length), so the credential can be verified by apps/admin/auth.ts unchanged.
//
// Usage (from repo root):
//   node packages/db/scripts/create-admin-user.js <email> <password>
//
// Defaults to superadmin@test.com / test1234 if no args are given.
//
// Requires DATABASE_URL / DIRECT_URL to be set in the environment (see root .env).

const { PrismaClient } = require("@prisma/client");
const { randomBytes, scrypt: scryptCallback } = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(scryptCallback);
const KEY_LEN = 64;

const prisma = new PrismaClient();

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LEN);
  return `${salt}:${derived.toString("hex")}`;
}

async function main() {
  const email = (process.argv[2] || "superadmin@test.com").trim().toLowerCase();
  const password = process.argv[3] || "test1234";

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "Super Admin",
      role: "SUPER_ADMIN",
      kycStatus: "APPROVED",
      adminCredential: {
        create: { passwordHash },
      },
    },
    update: {
      role: "SUPER_ADMIN",
    },
  });

  // Ensure the AdminCredential exists and has the requested password (upsert doesn't
  // let us nest-upsert on update, so handle the update-path credential separately).
  await prisma.adminCredential.upsert({
    where: { userId: user.id },
    create: { userId: user.id, passwordHash },
    update: { passwordHash },
  });

  console.log(`✅ Admin user ready: ${email} (id=${user.id}, role=SUPER_ADMIN)`);
  console.log(`   Password: ${password}`);
}

main()
  .catch((err) => {
    console.error("Failed to create admin user:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
