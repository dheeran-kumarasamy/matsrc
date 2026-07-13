import { notFound } from "next/navigation";
import { getSupplierProduct } from "@/lib/listings";
import ProductQuickView from "@/components/products/ProductQuickView";

export const dynamic = "force-dynamic";

// Intercepting route (Next.js "(.)" convention): when the user navigates to
// /products/[slug] FROM somewhere already inside the (builder) route group
// (e.g. clicking a ProductCard on /products), Next.js renders THIS page into
// the @modal parallel slot instead of the real page — so the PLP underneath
// never unmounts. Direct load / refresh / shared link bypasses interception
// entirely and renders the full standalone page at
// app/(builder)/products/[slug]/page.tsx. This is the crux of the spec 5A
// single-page overlay ordering architecture.
export default async function ProductQuickViewRoute({ params }: { params: { slug: string } }) {
  const product = await getSupplierProduct(params.slug);
  if (!product) notFound();

  return <ProductQuickView product={product} />;
}
