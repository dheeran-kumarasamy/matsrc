// packages/db/scripts/create-admin-user.js
//
// One-off script: creates (or updates) a SUPER_ADMIN user + AdminCredential for
// logging into the admin portal (apps/admin), using the same scrypt-based password
// hashing scheme as apps/admin/lib/password.ts (salt:hashHex, scrypt with 64-byte
// key length), so the credential can be verified by apps/admin/auth.ts unchanged.
//
// Usage (from repo root, via the pnpm wrapper so workspace env precedence applies):
//   pnpm --filter @matsrc/db exec node scripts/create-admin-user.js <email> <password>
//
// Defaults to superadmin@test.com / test1234 if no args are given.
//
// Requires DATABASE_URL / DIRECT_URL to be set in the environment (see root .env).
//
// SAFETY: loads .env.local (if present) BEFORE .env, matching every other
// script in this package (db-identity.js, prisma-safe.js,
// reset-test-data.js). PrismaClient is required lazily, AFTER this loading,
// because requiring @prisma/client triggers its own bundled dotenv auto-load
// of ".env" as a side effect — if that happened first (as it did prior to
// this fix), it could silently point this script at the wrong database
// (this exact bug once overwrote a production admin password — see incident
// notes in git history / docs/database/).
//
// Also refuses to run against a database detected as production unless
// ALLOW_PRODUCTION_DB_OPERATION=true is explicitly set, since this script
// changes a login credential.

const path = require("path");
const fs = require("fs");
const { randomBytes, scrypt: scryptCallback } = require("crypto");
const { promisify } = require("util");
const { isProductionDatabase, detectEnvironment, redactConnectionString } = require("../lib/db-safety");

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// .env.local (gitignored) takes priority over .env, same precedence as
// every other script in this package.
loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const scrypt = promisify(scryptCallback);
const KEY_LEN = 64;

// Required only now, after env loading above — see the safety comment at
// the top of this file.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LEN);
  return `${salt}:${derived.toString("hex")}`;
}

async function main() {
  const environment = detectEnvironment(process.env);
  const databaseUrl = process.env.DATABASE_URL;
  const databaseIsProduction = databaseUrl ? isProductionDatabase(databaseUrl, process.env) : false;

  console.log(`Target DATABASE_URL: ${redactConnectionString(databaseUrl)}`);
  console.log(`Production detected: ${databaseIsProduction || environment === "production" ? "YES ⚠" : "NO"}`);

  if ((databaseIsProduction || environment === "production") && process.env.ALLOW_PRODUCTION_DB_OPERATION !== "true") {
    console.error(
      "\nBLOCKED: this would modify a login credential on a database detected as " +
        "production. Set ALLOW_PRODUCTION_DB_OPERATION=true to proceed explicitly if " +
        "this is really intended.\n"
    );
    process.exitCode = 1;
    return;
  }

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
