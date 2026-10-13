-- Bug fix: CanonicalProduct grouping previously had no field for physical
-- size/diameter, so two listings that only differ by size (e.g. an 8mm
-- TMT bar vs. a 16mm TMT bar, same brand+grade+unit) computed an identical
-- canonicalKey and were silently merged into one CanonicalProduct. The
-- buyer-facing PLP only shows one card per CanonicalProduct, so every size
-- except the group's lowest-priced one was invisible to buyers even
-- though its Product row was fully active.
--
-- Purely additive: both new columns are nullable, so every existing row
-- is valid without a backfill value, and no existing data is modified.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "sizeLabel" TEXT;

-- AlterTable
ALTER TABLE "CanonicalProduct" ADD COLUMN "sizeLabel" TEXT;
