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
    <section className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 md:text-3xl">Shop by Category</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {categories.map(({ name, icon, slug }) => (
          <Link
            key={slug}
            href={`/products?category=${slug}`}
            className="flex min-h-[44px] flex-col items-center justify-center bg-white border border-gray-100 rounded-xl p-4 text-center hover:shadow-md hover:border-brand-500 transition-all"
          >
            <div className="text-3xl mb-2">{icon}</div>
            <div className="text-sm font-medium text-gray-600 leading-tight">{name}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
