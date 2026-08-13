#!/usr/bin/env node
// packages/db/scripts/check-unsafe-patterns.js
//
// Phase 6F-2 — CI safety check (spec §15, §23).
//
// Scans package.json scripts and script files for unsafe migration patterns
// that could bypass the safety wrapper.  Specifically detects:
//
//   prisma migrate diff --shadow-database-url "$DIRECT_URL"   <- Phase 6F incident
//
// Usage: pnpm --filter @matsrc/db db:check-unsafe-patterns
// Exits 0 if clean, 1 if unsafe patterns found.

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

const SCAN_FILES = [
  "packages/db/package.json",
  "package.json",
];

const SCAN_DIRS = [
  "packages/db/scripts",
];

const UNSAFE_PATTERNS = [
  {
    id: "UNSAFE_SHADOW_FROM_DIRECT_URL",
    pattern: /--shadow-database-url\s+["']?\$\{?DIRECT_URL\}?["']?/,
    description: "DIRECT_URL as --shadow-database-url — the exact Phase 6F incident pattern.",
    fix: "Use SHADOW_DATABASE_URL from a dedicated disposable database.",
  },
  {
    id: "UNSAFE_SHADOW_FROM_DATABASE_URL",
    pattern: /--shadow-database-url\s+["']?\$\{?DATABASE_URL\}?["']?/,
    description: "DATABASE_URL as --shadow-database-url — same class of error.",
    fix: "Use SHADOW_DATABASE_URL from a dedicated disposable database.",
  },
  {
    id: "UNSAFE_SHADOW_FALLBACK_TO_DIRECT",
    pattern: /SHADOW_DATABASE_URL\s*\|+\s*DIRECT_URL|shadowUrl\s*\?\?\s*directUrl/,
    description: "Fallback from SHADOW_DATABASE_URL to DIRECT_URL — forbidden (spec §8).",
    fix: "Remove the fallback. SHADOW_DATABASE_URL is mandatory with no fallback allowed.",
  },
  {
    id: "UNSAFE_SHADOW_FALLBACK_TO_DATABASE",
    pattern: /SHADOW_DATABASE_URL\s*\|+\s*DATABASE_URL|shadowUrl\s*\?\?\s*databaseUrl/,
    description: "Fallback from SHADOW_DATABASE_URL to DATABASE_URL — forbidden.",
    fix: "Remove the fallback. SHADOW_DATABASE_URL is mandatory with no fallback allowed.",
  },
];

const SCAN_EXTENSIONS = new Set([".js", ".ts", ".json", ".sh"]);

const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.next/,
  /dist\//,
  /coverage\//,
  /check-unsafe-patterns\.js$/,
  /verify-db-safety\.js$/,
];

function shouldExclude(fp) {
  return EXCLUDE_PATTERNS.some((p) => p.test(fp));
}

function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) collectFiles(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(full))) out.push(full);
  }
  return out;
}

function scanFile(filePath) {
  if (shouldExclude(filePath)) return [];
  let content;
  try { content = fs.readFileSync(filePath, "utf8"); } catch { return []; }
  const findings = [];
  content.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|#|\*)/.test(line)) return;
    for (const { id, pattern, description, fix } of UNSAFE_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ file: filePath, line: i + 1, content: line.trim(), id, description, fix });
      }
    }
  });
  return findings;
}

function main() {
  const filesToScan = [];
  for (const rel of SCAN_FILES) filesToScan.push(path.join(ROOT, rel));
  for (const rel of SCAN_DIRS) collectFiles(path.join(ROOT, rel), filesToScan);

  const allFindings = [];
  for (const fp of filesToScan) allFindings.push(...scanFile(fp));

  if (allFindings.length === 0) {
    console.log("check-unsafe-patterns: OK — no unsafe migration patterns detected.");
    process.exitCode = 0;
    return;
  }

  console.error(`\ncheck-unsafe-patterns: FAILED — ${allFindings.length} unsafe pattern(s) detected.\n`);
  for (const f of allFindings) {
    console.error(`  File:    ${f.file}`);
    console.error(`  Line:    ${f.line}`);
    console.error(`  Pattern: [${f.id}] ${f.description}`);
    console.error(`  Content: ${f.content}`);
    console.error(`  Fix:     ${f.fix}\n`);
  }
  console.error("See docs/database/database-safety.md for safe alternatives.");
  process.exitCode = 1;
}

main();
