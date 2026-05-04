import Link from "next/link";

const categories = [
  { name: "Steel & TMT Bars", icon: "🔩", slug: "steel" },
  { name: "Cement", icon: "🏗️", slug: "cement" },
  { name: "Bricks & Blocks", icon: "🧱", slug: "bricks" },
  { name: "Sand & Aggregates", icon: "⛏️", slug: "aggregates" },
  { name: "Pipes & Fittings", icon: "🔧", slug: "pipes" },
  { name: "Electrical", icon: "⚡", slug: "electrical" },
  { name: "Plywood & Timber", icon: "🪵", slug: "plywood" },
  { name: "Paints & Chemicals", icon: "🎨", slug: "paints" },
];

export default function CategoryGrid() {
  return (
    <section className="max-w-7xl mx-auto px-4 py-12">
      <h2 className="text-xl font-bold text-gray-800 mb-6">Shop by Category</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {categories.map(({ name, icon, slug }) => (
          <Link
            key={slug}
            href={`/products?category=${slug}`}
            className="bg-white border border-gray-100 rounded-xl p-4 text-center hover:shadow-md hover:border-brand-500 transition-all"
          >
            <div className="text-3xl mb-2">{icon}</div>
            <div className="text-xs font-medium text-gray-600 leading-tight">{name}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
