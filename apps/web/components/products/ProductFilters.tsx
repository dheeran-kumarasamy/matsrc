"use client";

// FR-04: Faceted filter sidebar
export default function ProductFilters() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-5">
      <h3 className="font-semibold text-sm text-gray-800">Filters</h3>

      {/* Category */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Category</p>
        {["Steel & TMT", "Cement", "Bricks", "Sand", "Pipes"].map((c) => (
          <label key={c} className="flex items-center gap-2 text-xs text-gray-600 mb-1.5 cursor-pointer">
            <input type="checkbox" className="accent-brand-500" /> {c}
          </label>
        ))}
      </div>

      {/* Price range */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Price Range (₹/MT)</p>
        <div className="flex gap-2">
          <input type="number" placeholder="Min" className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
          <input type="number" placeholder="Max" className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
        </div>
      </div>

      {/* Brand */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Brand</p>
        {["SAIL", "TATA Steel", "JSW", "Ambuja", "UltraTech"].map((b) => (
          <label key={b} className="flex items-center gap-2 text-xs text-gray-600 mb-1.5 cursor-pointer">
            <input type="checkbox" className="accent-brand-500" /> {b}
          </label>
        ))}
      </div>

      {/* BIS Certified only */}
      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" className="accent-brand-500" />
        BIS Certified only
      </label>

      {/* Verified suppliers only */}
      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" className="accent-brand-500" />
        Verified Quality Badge only
      </label>

      <button className="w-full bg-brand-500 text-white rounded-lg py-2 text-xs font-medium">Apply Filters</button>
      <button className="w-full text-xs text-gray-400 hover:text-gray-600">Clear all</button>
    </div>
  );
}
