// FR-21 & FR-22: Source city × brand price grid
const cities = ["EX-Raipur", "EX-Vizag", "EX-Durgapur", "EX-Jamshedpur"];
const brands = ["SAIL", "TATA Steel", "JSW", "RINL"];

export default function PriceGrid({ productSlug }: { productSlug: string }) {
  // Placeholder data — fetched from API in production
  const grid: Record<string, Record<string, number>> = {};
  brands.forEach((b) => {
    grid[b] = {};
    cities.forEach((c) => { grid[b][c] = 58000 + Math.round(Math.random() * 8000); });
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left text-gray-400 font-medium pb-2 pr-4">Brand</th>
            {cities.map((c) => (
              <th key={c} className="text-right text-gray-400 font-medium pb-2 px-3">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {brands.map((brand) => (
            <tr key={brand} className="border-t border-gray-50">
              <td className="py-2 pr-4 font-medium text-gray-700">{brand}</td>
              {cities.map((city) => (
                <td key={city} className="py-2 px-3 text-right">
                  <span className="font-semibold text-gray-800">₹{grid[brand][city].toLocaleString("en-IN")}</span>
                  <span className="text-gray-400 ml-1">/MT</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-400 mt-3">Delivered cost to your pincode = EX price + freight. Freight calculated at checkout.</p>
    </div>
  );
}
