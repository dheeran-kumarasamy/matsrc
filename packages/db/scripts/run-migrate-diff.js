#!/usr/bin/env node
// packages/db/scripts/run-migrate-diff.js
// Phase 6F-3A only. Keeps shadow endpoint alive during migrate-diff.
// Does NOT bypass the safety wrapper. Does NOT touch production.
"use strict";
const { spawnSync, spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const DB_DIR = path.join(__dirname, "..");

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
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
loadEnvFile(path.join(DB_DIR, ".env.local"));
loadEnvFile(path.join(DB_DIR, ".env"));

const SHADOW_URL = process.env.SHADOW_DATABASE_URL;
if (!SHADOW_URL) {
  process.stderr.write("SHADOW_DATABASE_URL is not set.\n");
  process.exit(1);
}

process.stderr.write("Waking shadow endpoint...\n");
for (let i = 0; i < 5; i++) {
  const r = spawnSync("psql", [SHADOW_URL, "-c", "SELECT 1"], { timeout: 25000 });
  if (r.status === 0) { process.stderr.write(`Shadow awake (attempt ${i + 1})\n`); break; }
  process.stderr.write(`Wake attempt ${i + 1} failed, retrying...\n`);
}

process.stderr.write("Starting keepalive psql (pg_sleep 90)...\n");
const keepalive = spawn("psql", [SHADOW_URL, "-c", "SELECT pg_sleep(90)"], {
  stdio: ["ignore", "ignore", "ignore"],
  detached: false,
});

try { execSync("sleep 3"); } catch {}

process.stderr.write("Invoking safety wrapper...\n");
const result = spawnSync(
  "node",
  [path.join(DB_DIR, "scripts/prisma-safe.js"), "migrate-diff",
    "--from-migrations", "./prisma/migrations",
    "--to-schema-datamodel", "./prisma/schema.prisma",
    "--script"],
  { stdio: ["inherit", "pipe", "pipe"], timeout: 120000, cwd: DB_DIR, env: process.env }
);
try { keepalive.kill("SIGTERM"); } catch {}

if (result.stderr && result.stderr.length > 0) process.stderr.write(result.stderr);
if (result.status !== 0 || result.error) {
  process.stderr.write("migrate-diff exit code: " + result.status + "\n");
  if (result.error) process.stderr.write("Error: " + result.error.message + "\n");
  process.exit(result.status === null ? 1 : result.status);
}
if (result.stdout && result.stdout.length > 0) process.stdout.write(result.stdout);
process.stderr.write("migrate-diff completed successfully.\n");
