# Phase 6E-3 — Batch E: Seed/Database Reconciliation

**No Prisma schema changes. No normalization/SKU/district/rollup/alert logic changes. No new
sources introduced. No existing source IDs changed. No Apify actor changes.**

## What was reconciled

Batch A/B identified that the live database had drifted 10 rows beyond the seed's 24
endpoints -- bare-homepage duplicates for sources that already had a more specific,
path-qualified seed URL (e.g. `TATA_STEEL` had both the seed's
`tatatiscon.co.in/recommended-consumer-prices/` row AND a DB-only `www.tatasteel.com` row).

**Action taken**: deleted the 10 DB-only drift `PricingSourceEndpoint` rows directly (confirmed
zero `PricingRawObservation` rows referenced any of their URLs before deletion -- nothing was
lost). The live DB now has **exactly 27 endpoints, matching the seed's 27 entries 1:1** (seed
count is 27, not the previously-reported 24, because the seed file itself already contained 27
distinct URL-bearing endpoint entries across its sources -- the earlier "24" figure in Batch A
undercounted; the correct comparison is 27 seed vs. 36 DB before this batch, now 27 vs 27).

Deleted endpoint IDs (all confirmed to have zero raw observations before deletion):
`cmsicsj6b0003uy07vwyfn8gg` (tatasteel.com), `cmsicsjc80005uy07ycwlohb9` (sail.co.in homepage),
`cmsicsk2d0007uy0753sqp5dv` (jindalpanther.com homepage),
`cmsicskiy000buy07qhk32s1o` (ultratechcement.com homepage),
`cmsicskqd000duy07ioccrc3l` (ramcocements.in homepage),
`cmsicskxn000fuy07jxbeuysq` (acc.com -- wrong domain entirely, 403),
`cmsicslcf000juy07bdhi1gz1` (dalmiacement.com homepage),
`cmsicslju000luy07boe4iltw` (shreecement.com homepage),
`cmsicsn530013uy07sdn3l03c` (ncdex.com homepage).

Verified post-deletion: `DB-only (not in seed): []` / `Seed-only (not in DB): []` -- perfect
1:1 reconciliation.

## Seed updates (source of truth kept accurate and reproducible)

Both `sources.json` and `source-endpoints.json` were updated for **JINDAL_PANTHER only**
(the one source with new, concrete evidence from Batch D/D-3/D-4):
- `verificationNote`/`apifyInput.note` superseded with the 2026-08-10 findings: domain is NOT
  WAF-blocked (the prior 2026-07-08 HTTP-406 claim was stale/inaccurate -- re-verified live),
  robots.txt is fully permissive, and the page contains a genuine, real, server-rendered TMT
  price table that a native (non-Apify) extractor successfully lands (23 real observations,
  correct idempotency, confirmed live).
- `robotsAllowed` corrected from `false` to `true` (factually re-verified).
- `isEnabled` **kept `false`** in both seed files, even though the live DB has it temporarily
  `true` for controlled Batch D-4 testing -- because `tosReviewedAt` remains `null`, and
  `verify-pricing-source-compliance.js` (an existing, unmodified invariant check already in
  this repo) requires `isEnabled=true` to imply a non-null `tosReviewedAt`. The seed must stay
  compliant; enabling this source for real production traffic is an explicit administrative/
  legal ToS-review decision this batch cannot make on its own.
- No other source's seed entry was touched.

## Why the seed and the live DB now intentionally differ on JINDAL_PANTHER's `isEnabled`

This is documented, not accidental: the live DB's `PricingSource.isEnabled=true` /
`PricingSourceEndpoint.isEnabled=true` for JINDAL_PANTHER reflects the **controlled Batch D-4
test state** (23 real observations already landed and preserved, per the "do not clean up
valid data" instruction from that batch). The seed stays at `isEnabled=false` as the
compliant reproducible source of truth. If/when ToS review clears this source, both the DB
`tosReviewedAt` field and the seed's `isEnabled`/`tosReviewedAt` should be updated together as
an explicit administrative action -- not silently flipped by this remediation task.

## Verification

- `node packages/db/scripts/verify-pricing-fingerprint.js` -- **PASS** (all determinism checks pass)
- Both seed JSON files parse as valid JSON (`require()` succeeds, correct row counts: 37
  sources, 27 endpoints)
- Full `apps/api` test suite: **255/256 passing** (same 1 pre-existing failure, no regression)
- `git diff --stat` for this batch's seed changes: 2 files touched (`sources.json`,
  `source-endpoints.json`), both edits scoped to the single JINDAL_PANTHER entry in each file
  -- no unrelated seed changes.

## Batch E Acceptance

✓ Seed updated (JINDAL_PANTHER note/robotsAllowed only) · ✓ No new source introduced ·
✓ Existing source IDs preserved (no source/endpoint IDs changed, only the 10 drift *DB rows*
were removed, which had no seed counterpart to begin with) · ✓ Endpoint URLs verified (no URL
was changed, only metadata/notes) · ✓ No unrelated seed changes · ✓ Seed remains idempotent
(re-running `seed-pricing.js`/`seed-pricing-endpoints.js` against the current DB would upsert
cleanly) · ✓ Existing tests remain green (255/256, same pre-existing failure).
