import Link from "next/link";
import { getDefaultCategoryImage } from "@/lib/category-images";


interface Props {
  skeleton?: boolean;
  product?: {
    name: string;
    price: number;
    supplier: string;
    rating: number;
    change: number;
    slug: string;
    image?: string;
    category?: string;
  };
}

export default function ProductCard({ skeleton, product }: Props) {
  if (skeleton) {
    return (
      <div className="panel p-4 animate-pulse">
        <div className="h-32 bg-slate-100 rounded-lg mb-3" />
        <div className="h-4 bg-slate-100 rounded w-3/4 mb-2" />
        <div className="h-3 bg-slate-100 rounded w-1/2 mb-3" />
        <div className="h-6 bg-slate-100 rounded w-1/3" />
      </div>
    );
  }

  if (!product) return null;

  const imageUrl = product.image || getDefaultCategoryImage(product.category);

  return (
    // next/link (not a bare <a>) so that Next.js's intercepting-route
    // convention (@modal/(.)products/[slug]) can hijack this soft navigation
    // and render the product as a quick-view overlay instead of a full page
    // load — spec section 5A. Direct nav / refresh / shared links still hit
    // the full standalone page.
    <Link href={`/products/${product.slug}`} className="panel p-4 hover:shadow-md hover:border-blue-700 transition-all block">
      <div className="h-32 bg-slate-50 rounded-lg mb-3 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" />
      </div>
      <h3 className="font-semibold text-sm text-slate-800 line-clamp-2">{product.name}</h3>
      <p className="text-xs text-slate-400 mt-0.5">{product.supplier}</p>
      <div className="flex items-end justify-between mt-2">
        <div>
          <div className="text-lg font-bold text-slate-900">₹{product.price.toLocaleString("en-IN")}</div>
          <div className={`text-xs ${product.change < 0 ? "text-red-500" : "text-green-600"}`}>
            {product.change < 0 ? "↓" : "↑"} {Math.abs(product.change)}% today
          </div>
        </div>
        <span className="text-yellow-400 text-xs">★ {product.rating}</span>
      </div>
    </Link>
  );
}

