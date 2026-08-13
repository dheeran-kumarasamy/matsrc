#!/usr/bin/env node
// Read-only production sentinel count verification (Phase 6F-3A).
// Uses the Neon HTTP serverless driver — no TCP/5432 required.
// Does NOT modify production.
"use strict";
const { neon } = require("../../../node_modules/.pnpm/@neondatabase+serverless@0.9.5/node_modules/@neondatabase/serverless/index.js");
const PROD_URL = "postgresql://neondb_owner:npg_Z1bqkJQs5OAh@ep-muddy-meadow-aoh42y8u.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const sql = neon(PROD_URL);
(async () => {
  console.log("=== PRODUCTION SENTINEL COUNTS (read-only) ===");
  const expected = { User: 7, Product: 16, Order: 27, SupplierProfile: 2 };
  let allOk = true;
  for (const [table, exp] of Object.entries(expected)) {
    const rows = await sql("SELECT COUNT(*) as cnt FROM \"" + table + "\"");
    const actual = parseInt(rows[0].cnt);
    const ok = actual === exp;
    if (!ok) allOk = false;
    console.log(table + ": " + actual + (ok ? " OK" : " MISMATCH expected=" + exp));
  }
  const pr = await sql("SELECT COUNT(*) as cnt FROM pricing_source");
  const pd = await sql("SELECT COUNT(*) as cnt FROM pricing_district");
  const prOk = parseInt(pr[0].cnt) === 37;
  const pdOk = parseInt(pd[0].cnt) === 38;
  if (!prOk || !pdOk) allOk = false;
  console.log("pricing_source: " + pr[0].cnt + (prOk ? " OK" : " MISMATCH"));
  console.log("pricing_district: " + pd[0].cnt + (pdOk ? " OK" : " MISMATCH"));
  const sourcing = await sql("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'Sourcing%'");
  const sourcingAbsent = sourcing.length === 0;
  console.log("Sourcing* tables in production: " + (sourcingAbsent ? "ABSENT (correct)" : "PRESENT (" + sourcing.map(r => r.table_name).join(", ") + ")"));
  if (!sourcingAbsent) allOk = false;
  console.log("Production unchanged: " + (allOk ? "YES" : "NO — STOP IMMEDIATELY"));
  if (!allOk) process.exitCode = 1;
})().catch(e => { console.error("Error:", e.message); process.exitCode = 1; });
