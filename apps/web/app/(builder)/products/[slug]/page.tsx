import { prisma } from "@matsrc/db";
import PriceChart from "@/components/products/PriceChart";
import PriceGrid from "@/components/products/PriceGrid";
import AddToCartButton from "@/components/cart/AddToCartButton";
import WatchlistButton from "@/components/products/WatchlistButton";
import { Eye } from "lucide-react";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface Props {
  params: { slug: string };
}

// Fetch product from DB by id or slug — FR-35, FR-21, FR-22
async function getProduct(idOrSlug: string) {
  try {
    return await prisma.product.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], isActive: true },
      include: {
        category: true,
        supplier: true,
        prices: { orderBy: { recordedAt: "desc" } },
      },
    });
  } catch {
    return null;
  }
}

// Fetch sibling products in the same category for brand × city price grid (FR-21/FR-22)
async function getSiblingPriceRows(categoryId: string, excludeId: string) {
  try {
    const siblings = await prisma.product.findMany({
      where: { categoryId, isActive: true, brand: { not: null } },
      include: { prices: { orderBy: { recordedAt: "desc" } } },
    });
    // Build flat { brand, sourceCity, price } rows — one entry per brand×city (latest price)
    const rows: { brand: string; sourceCity: string; price: number }[] = [];
    const seen = new Set<string>();
    for (const p of siblings) {
      if (!p.brand) continue;
      for (const pt of p.prices) {
        const key = `${p.brand}|${pt.sourceCity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ brand: p.brand, sourceCity: pt.sourceCity, price: Number(pt.price) });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

// FR-36: Dynamic badge based on bisStatus
function BisBadge({ bisStatus }: { bisStatus: string | null }) {
  if (bisStatus === "CERTIFIED") {
    return (
      <span className="bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200">
        ✓ BIS Certified
      </span>
    );
  }
  if (bisStatus === "PENDING") {
    return (
      <span className="bg-amber-50 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-200">
        ⏳ BIS Pending
      </span>
    );
  }
  return (
    <span className="bg-slate-50 text-slate-500 text-xs font-semibold px-2.5 py-1 rounded-full border border-slate-200">
      Unverified
    </span>
  );
}

// UF-02 Steps 3–8: Product detail, price grid, chart, watchlist, add to cart
export default async function ProductDetailPage({ params }: Props) {
  const product = await getProduct(params.slug);
  if (!product) notFound();

  const priceHistory = product.prices.map((pt) => ({
    price: Number(pt.price),
    recordedAt: pt.recordedAt.toISOString(),
  }));

  const gridRows = await getSiblingPriceRows(product.categoryId, product.id);

  const basePrice = Number(product.basePrice);

  // FR-35: spec rows including grade, IS code, BIS status
  const specs: [string, string][] = [
    ["Category", product.category.name],
    ["Brand", product.brand ?? "—"],
    ["Grade", product.grade ?? "—"],
    ["IS Code", product.isCode ?? "—"],
    ["BIS Status", product.bisStatus ?? "—"],
    ["Unit", product.unit],
    ["Supplier", product.supplier.companyName],
    ["Stock", `${product.stock} ${product.unit}`],
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-400 flex gap-2">
        <a href="/products" className="hover:text-blue-700">Materials</a>
        <span>/</span>
        <span className="text-slate-600 capitalize">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Product info */}
        <div className="lg:col-span-2 space-y-5">
          <div className="panel p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{product.name}</h1>
                {product.description && (
                  <p className="text-sm text-slate-400 mt-1">{product.description}</p>
                )}
              </div>
              {/* FR-36: Dynamic BIS badge */}
              <div className="shrink-0">
                <BisBadge bisStatus={product.bisStatus ?? null} />
              </div>
            </div>

            {/* Images */}
            <div className="mt-4 h-48 bg-slate-100 rounded-lg flex items-center justify-center text-slate-300 text-sm">
              Product image
            </div>

            {/* FR-35: Specs including grade, IS code, BIS status */}
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {specs.map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-400">{k}</span>
                  <span className="font-medium text-slate-700">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* FR-23/FR-07: Price movement chart with real PricePoint data */}
          <div className="panel p-5">
            <h2 className="font-semibold text-slate-800 mb-4">Price Trend</h2>
            <PriceChart priceHistory={priceHistory} />
          </div>

          {/* FR-21 & FR-22: Source city × brand price grid with real PricePoint data */}
          <div className="panel p-5">
            <h2 className="font-semibold text-slate-800 mb-4">Source City Prices</h2>
            <PriceGrid rows={gridRows} />
          </div>
        </div>

        {/* Right: Buy panel */}
        <div className="space-y-4">
          <div className="panel p-5 sticky top-20">
            {/* Live price — FR-06 */}
            <div className="text-3xl font-bold text-slate-900">
              ₹{basePrice.toLocaleString("en-IN")} <span className="text-base font-normal text-slate-400">/ {product.unit}</span>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Quantity ({product.unit})</label>
                <input
                  type="number"
                  min={1}
                  defaultValue={1}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>

              <AddToCartButton productId={product.id} />

              {/* FR-07: Watchlist */}
              <WatchlistButton productId={product.id} />
            </div>

            {/* FR-05: Compare link */}
            <button className="mt-4 w-full flex items-center justify-center gap-2 text-xs text-blue-700 hover:underline">
              <Eye size={14} /> Add to Compare (up to 4)
            </button>

            {/* Supplier info */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-400 mb-2">Top supplier</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-500">
                  {product.supplier.companyName[0]}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">{product.supplier.companyName}</p>
                  <p className="text-xs text-slate-400">
                    {product.supplier.bisVerified ? "⭐ BIS Verified" : "⭐ Verified"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
