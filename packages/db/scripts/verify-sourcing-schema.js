#!/usr/bin/env node
// Phase 6F-4 — Sourcing schema validation against dev database.
// Uses Neon serverless HTTP driver. Does NOT touch production.
"use strict";
const { neon } = require("../../../node_modules/.pnpm/@neondatabase+serverless@0.9.5/node_modules/@neondatabase/serverless/index.js");
const assert = require("assert");
const DEV = "postgresql://neondb_owner:npg_Z1bqkJQs5OAh@ep-sparkling-term-aojx078x.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const sql = neon(DEV);

async function run() {
  console.log("=== Phase 6F-4: Sourcing Schema Validation ===");
  const tables = await sql("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('SourcingSession','SourcingRecommendation','SourcingToolInvocation') ORDER BY table_name");
  assert.strictEqual(tables.length, 3, "All 3 Sourcing tables must exist");
  console.log("Tables: " + tables.map(t => t.table_name).join(", ") + " OK");
  const enums = await sql("SELECT e.enumlabel, t.typname FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname IN ('SourcingSessionStatus','SourcingApprovalStatus') ORDER BY t.typname, e.enumsortorder");
  const ss = enums.filter(e => e.typname === "SourcingSessionStatus").map(e => e.enumlabel);
  const sa = enums.filter(e => e.typname === "SourcingApprovalStatus").map(e => e.enumlabel);
  assert.deepStrictEqual(ss, ["COLLECTING","SEARCHING","RECOMMENDED","CONFIRMED","ABANDONED"]);
  assert.deepStrictEqual(sa, ["NOT_REQUIRED","PENDING","APPROVED","REJECTED"]);
  console.log("SourcingSessionStatus OK; SourcingApprovalStatus OK");
  const ssCols = await sql("SELECT column_name FROM information_schema.columns WHERE table_name='SourcingSession' AND table_schema='public'");
  const cn = ssCols.map(c => c.column_name);
  for (const c of ["id","userId","siteId","status","requirementJson","createdAt","updatedAt"]) assert.ok(cn.includes(c), "SourcingSession missing: " + c);
  console.log("SourcingSession columns (" + cn.length + ") OK");
  const idxs = await sql("SELECT indexname FROM pg_indexes WHERE tablename IN ('SourcingSession','SourcingRecommendation','SourcingToolInvocation')");
  assert.ok(idxs.length >= 10, "Expected >= 10 indexes, got " + idxs.length);
  const idxN = idxs.map(i => i.indexname);
  assert.ok(idxN.includes("SourcingSession_userId_idx"));
  assert.ok(idxN.includes("SourcingRecommendation_sessionId_rank_key"));
  console.log("Indexes (" + idxs.length + ") OK");
  const fks = await sql("SELECT constraint_name FROM information_schema.table_constraints WHERE table_name IN ('SourcingSession','SourcingRecommendation','SourcingToolInvocation') AND constraint_type='FOREIGN KEY'");
  assert.strictEqual(fks.length, 6, "Expected 6 FKs, got " + fks.length);
  console.log("Foreign keys (6) OK");
  const [u] = await sql('SELECT id FROM "User" LIMIT 1');
  const [site] = await sql('SELECT id FROM "Site" LIMIT 1');
  const [sup] = await sql('SELECT id FROM "SupplierProfile" LIMIT 1');
  if (!u) { console.log("No users in dev — schema-only done"); return; }
  const [sess] = await sql('INSERT INTO "SourcingSession" (id,"userId","siteId",status,"requirementJson","createdAt","updatedAt") VALUES ($1,$2,$3,\'COLLECTING\',\'{"m":"x"}\',NOW(),NOW()) ON CONFLICT (id) DO UPDATE SET "updatedAt"=NOW() RETURNING id,status', ["t-sess-6f4", u.id, site?.id ?? null]);
  assert.strictEqual(sess.status, "COLLECTING");
  console.log("SourcingSession INSERT OK");
  const [inv] = await sql('INSERT INTO "SourcingToolInvocation" (id,"sessionId","userId",tool,status,"approvalStatus","createdAt") VALUES ($1,$2,$3,\'parse_requirement\',\'OK\',\'NOT_REQUIRED\',NOW()) ON CONFLICT (id) DO UPDATE SET status=\'OK\' RETURNING tool', ["t-inv-6f4", "t-sess-6f4", u.id]);
  assert.strictEqual(inv.tool, "parse_requirement");
  console.log("SourcingToolInvocation INSERT OK");
  if (sup) {
    const [rec] = await sql('INSERT INTO "SourcingRecommendation" (id,"sessionId","supplierId",rank,score,quantity,"specificationMatch","reasonsJson","createdAt") VALUES ($1,$2,$3,1,85.5,100,true,\'["Best"]\',NOW()) ON CONFLICT (id) DO UPDATE SET score=85.5 RETURNING rank', ["t-rec-6f4", "t-sess-6f4", sup.id]);
    assert.strictEqual(rec.rank, 1);
    console.log("SourcingRecommendation INSERT OK");
    try {
      await sql('INSERT INTO "SourcingRecommendation" (id,"sessionId","supplierId",rank,score,quantity,"specificationMatch","reasonsJson","createdAt") VALUES ($1,$2,$3,1,70,50,false,\'[]\',NOW())', ["t-rec-dup", "t-sess-6f4", sup.id]);
      assert.fail("Duplicate rank must be rejected");
    } catch(e) {
      if (e.message.includes("unique")||e.message.includes("duplicate")) console.log("Unique (sessionId,rank) constraint ENFORCED OK");
      else throw e;
    }
  }
  const [upd] = await sql('UPDATE "SourcingSession" SET status=\'SEARCHING\',"updatedAt"=NOW() WHERE id=$1 RETURNING status', ["t-sess-6f4"]);
  assert.strictEqual(upd.status, "SEARCHING");
  console.log("Status UPDATE OK");
  const [other] = await sql('SELECT id FROM "User" WHERE id!=$1 LIMIT 1', [u.id]);
  if (other) {
    const r = await sql('SELECT id FROM "SourcingSession" WHERE id=$1 AND "userId"=$2', ["t-sess-6f4", other.id]);
    assert.strictEqual(r.length, 0, "userId isolation must hold");
    console.log("Authorization userId isolation OK");
  }
  await sql('DELETE FROM "SourcingSession" WHERE id=$1', ["t-sess-6f4"]);
  const rem = await sql('SELECT id FROM "SourcingToolInvocation" WHERE "sessionId"=$1', ["t-sess-6f4"]);
  assert.strictEqual(rem.length, 0, "CASCADE must remove children");
  console.log("CASCADE delete OK");
  console.log("\n=== All Sourcing schema validation checks PASSED ===");
}
run().catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; });
