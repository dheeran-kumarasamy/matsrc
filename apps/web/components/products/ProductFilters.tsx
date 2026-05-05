"use client";

// FR-04: Faceted filter sidebar
export default function ProductFilters() {
  return (
    <div className="panel p-4 space-y-5">
      <h3 className="font-semibold text-sm text-slate-800">Filters</h3>

      {/* Category */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-2">Category</p>
        {["Steel & TMT", "Cement", "Bricks", "Sand", "Pipes"].map((c) => (
          <label key={c} className="flex items-center gap-2 text-xs text-slate-600 mb-1.5 cursor-pointer">
            <input type="checkbox" className="accent-blue-700" /> {c}
          </label>
        ))}
      </div>

      {/* Price range */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-2">Price Range (₹/MT)</p>
        <div className="flex gap-2">
          <input type="number" placeholder="Min" className="w-full border border-slate-200 rounded px-2 py-1 text-xs" />
          <input type="number" placeholder="Max" className="w-full border border-slate-200 rounded px-2 py-1 text-xs" />
        </div>
      </div>

      {/* Brand */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-2">Brand</p>
        {["SAIL", "TATA Steel", "JSW", "Ambuja", "UltraTech"].map((b) => (
          <label key={b} className="flex items-center gap-2 text-xs text-slate-600 mb-1.5 cursor-pointer">
            <input type="checkbox" className="accent-blue-700" /> {b}
          </label>
        ))}
      </div>

      {/* BIS Certified only */}
      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" className="accent-blue-700" />
        BIS Certified only
      </label>

      {/* Verified suppliers only */}
      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" className="accent-blue-700" />
        Verified Quality Badge only
      </label>

      <button className="w-full bg-blue-700 text-white rounded-lg py-2 text-xs font-medium hover:bg-blue-800 transition-colors">Apply Filters</button>
      <button className="w-full text-xs text-slate-400 hover:text-slate-600">Clear all</button>
    </div>
  );
}
