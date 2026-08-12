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
    supplier: string;
    rating: number;
    change: number;
    slug: string;
    image?: string;
    category?: string;
  };
}

// Product card — refined with Posh editorial typography and spacing.
// All existing functionality (intercepting routes, price range, slug) unchanged.
export default function ProductCard({ skeleton, product }: Props) {
  if (skeleton) {
    return (
      <div className="panel p-5 animate-pulse">
        <div className="h-36 bg-slate-100 rounded-2xl mb-4" />
        <div className="h-4 bg-slate-100 rounded w-3/4 mb-2" />
        <div className="h-3 bg-slate-100 rounded w-1/2 mb-4" />
        <div className="h-7 bg-slate-100 rounded w-1/3" />
      </div>
    );
  }

  if (!product) return null;

  const imageUrl = product.image;

  return (
    // next/link so that Next.js intercepting-route convention
    // (@modal/(.)products/[slug]) renders the quick-view overlay — spec 5A.
    <Link
      href={`/products/${product.slug}`}
      className="panel p-5 hover:shadow-lg hover:border-blue-300 transition-all duration-200 block group"
    >
      {/* Image / emoji area */}
      <div className="h-36 bg-slate-50 rounded-2xl mb-4 overflow-hidden flex items-center justify-center">
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
      <h3 className="font-medium text-sm text-slate-800 line-clamp-2 leading-snug">{product.name}</h3>

      {/* Supplier */}
      <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-wide">{product.supplier}</p>

      {/* Price row */}
      <div className="flex items-end justify-between mt-3">
        <div>
          {product.minPrice != null && product.maxPrice != null && product.maxPrice > product.minPrice ? (
            <div
              className="text-lg font-normal tracking-tight"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", color: "#1a4f8a" }}
            >
              ₹{product.minPrice.toLocaleString("en-IN")} – ₹{product.maxPrice.toLocaleString("en-IN")}
            </div>
          ) : (
            <div
              className="text-xl font-normal tracking-tight"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", color: "#1a4f8a" }}
            >
              ₹{product.price.toLocaleString("en-IN")}
            </div>
          )}
          <div className={`text-[11px] mt-0.5 ${product.change < 0 ? "text-red-500" : "text-emerald-600"}`}>
            {product.change < 0 ? "↓" : "↑"} {Math.abs(product.change)}% today
          </div>
        </div>
        <span className="text-amber-500 text-xs font-medium">★ {product.rating}</span>
      </div>
    </Link>
  );
}


