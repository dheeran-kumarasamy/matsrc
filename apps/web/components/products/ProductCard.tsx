import Link from "next/link";
import { getCategoryEmoji } from "@/lib/category-images";

interface Props {
  skeleton?: boolean;
  product?: {
    name: string;
    price: number;
    // Min–max price range across the canonical product's cross-supplier
    // listings (REQ-02). Optional/backward compatible — when both are
    // present and differ, the card shows a range instead of a single price.
    minPrice?: number | null;
    maxPrice?: number | null;
    // Real unit label (e.g. "Bag", "Tonne") from the listing, used to show
    // "₹450 / Bag" style pricing instead of a bare number.
    unit?: string;
    supplier: string;
    // P0 fix (Phase 9): replaces the previous fabricated `rating`/`change`
    // fields (hardcoded ★4.6 and "↑ 0% today" for every card, backed by no
    // real data) with a truthful, data-backed count of suppliers actually
    // quoting this canonical product.
    supplierCount: number;
    slug: string;
    image?: string;
    category?: string;
  };
}

// Product card — industrial redesign: off-white surface, soft depth
// shadow, prominent charcoal price, orange "Request Quote" action that
// reveals on hover (desktop) / stays visible (touch). All existing
// functionality (intercepting routes, price range, slug) unchanged.
export default function ProductCard({ skeleton, product }: Props) {
  if (skeleton) {
    return (
      <div className="panel p-5 animate-pulse">
        <div className="h-36 bg-slate-100 rounded-lg mb-4" />
        <div className="h-4 bg-slate-100 rounded w-3/4 mb-2" />
        <div className="h-3 bg-slate-100 rounded w-1/2 mb-4" />
        <div className="h-7 bg-slate-100 rounded w-1/3" />
      </div>
    );
  }

  if (!product) return null;

  const imageUrl = product.image;
  const unitSuffix = product.unit ? ` / ${product.unit}` : "";

  return (
    // next/link so that Next.js intercepting-route convention
    // (@modal/(.)products/[slug]) renders the quick-view overlay — spec 5A.
    <Link
      href={`/products/${product.slug}`}
      className="panel relative block overflow-hidden p-5 transition-shadow duration-200 hover:shadow-lg group"
    >
      {/* Image / emoji area — rounded-lg per the modern-card spec */}
      <div className="h-36 bg-slate-50 rounded-lg mb-4 overflow-hidden flex items-center justify-center">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="text-5xl" role="img" aria-label={product.category || "Product"}>
            {getCategoryEmoji(product.category)}
          </span>
        )}
      </div>

      {/* Name */}
      <h3 className="font-semibold text-sm leading-snug line-clamp-2" style={{ color: "var(--posh-fg)" }}>
        {product.name}
      </h3>

      {/* Supplier */}
      <p className="mt-1 text-[11px] uppercase tracking-wide" style={{ color: "var(--posh-fg-muted)" }}>
        {product.supplier}
      </p>

      {/* Price row — high-contrast charcoal price, real unit label */}
      <div className="flex items-end justify-between mt-3">
        <div>
          {product.minPrice != null && product.maxPrice != null && product.maxPrice > product.minPrice ? (
            <div className="text-lg font-extrabold tracking-tight" style={{ color: "var(--posh-fg)" }}>
              ₹{product.minPrice.toLocaleString("en-IN")} – ₹{product.maxPrice.toLocaleString("en-IN")}
              {unitSuffix}
            </div>
          ) : (
            <div className="text-xl font-extrabold tracking-tight" style={{ color: "var(--posh-fg)" }}>
              ₹{product.price.toLocaleString("en-IN")}
              {unitSuffix}
            </div>
          )}
        </div>
        <span className="text-[11px] font-medium" style={{ color: "var(--posh-fg-muted)" }}>
          {product.supplierCount > 1
            ? `${product.supplierCount} suppliers quoting`
            : "1 supplier quoting"}
        </span>
      </div>

      {/* Quick "Request Quote" action — subtle, reveals on hover on
          pointer devices; stays visible on touch (no hover state) so it's
          always reachable on mobile. */}
      <span
        className="mt-4 flex min-h-[40px] w-full items-center justify-center rounded-lg text-xs font-bold uppercase tracking-wide opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100"
        style={{ background: "var(--posh-primary)", color: "var(--posh-primary-fg)" }}
      >
        Request Quote
      </span>
    </Link>
  );
}


