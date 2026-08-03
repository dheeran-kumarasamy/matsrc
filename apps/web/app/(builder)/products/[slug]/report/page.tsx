import Link from "next/link";
import { notFound } from "next/navigation";
import PriceReportView from "@/components/reports/PriceReportView";
import { getSupplierListings, type SupplierListing } from "@/lib/listings";

export const dynamic = "force-dynamic";

// Resolves the requested slug to its canonical cross-supplier group the
// same way the PDP page does, so the report page can be reached from a
// per-listing slug URL. Only reads listings — does NOT touch the public
// listings route's caching behavior.
function resolveCanonicalProductId(allListings: SupplierListing[], slug: string): string | null {
  const requested = allListings.find((listing) => listing.id === slug);
  if (!requested) return null;
  return requested.canonicalProductId || null;
}

export default async function PriceReportPage({ params }: { params: { slug: string } }) {
  const allListings = await getSupplierListings();
  const canonicalProductId = resolveCanonicalProductId(allListings, params.slug);

  if (!canonicalProductId) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-2 text-xs text-slate-400">
        <Link href="/products" className="hover:text-blue-700">
          Materials
        </Link>
        <span>/</span>
        <Link href={`/products/${params.slug}`} className="hover:text-blue-700">
          Product
        </Link>
        <span>/</span>
        <span className="text-slate-600">Price Report</span>
      </nav>

      <PriceReportView canonicalProductId={canonicalProductId as string} />
    </div>
  );
}
