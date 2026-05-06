type PriceRow = { brand: string; sourceCity: string; price: number };

// FR-21 & FR-22: Source city × brand price grid (real PricePoint data)
export default function PriceGrid({ rows }: { rows: PriceRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-slate-300 text-sm">
        No source city pricing data available yet
      </div>
    );
  }

  // Derive unique brands and cities from the data
  const brands = [...new Set(rows.map((r) => r.brand))].sort();
  const cities = [...new Set(rows.map((r) => r.sourceCity))].sort();

  // Build lookup: brand → city → price
  const grid: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (!grid[row.brand]) grid[row.brand] = {};
    grid[row.brand][row.sourceCity] = row.price;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left text-slate-400 font-medium pb-2 pr-4">Brand</th>
            {cities.map((c) => (
              <th key={c} className="text-right text-slate-400 font-medium pb-2 px-3">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {brands.map((brand) => (
            <tr key={brand} className="border-t border-slate-50">
              <td className="py-2 pr-4 font-medium text-slate-700">{brand}</td>
              {cities.map((city) => (
                <td key={city} className="py-2 px-3 text-right">
                  <span className="font-semibold text-slate-800">₹{grid[brand][city].toLocaleString("en-IN")}</span>
                  <span className="text-slate-400 ml-1">/MT</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 mt-3">Delivered cost to your pincode = EX price + freight. Freight calculated at checkout.</p>
    </div>
  );
}
