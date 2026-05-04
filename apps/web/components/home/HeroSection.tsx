import Link from "next/link";

export default function HeroSection() {
  return (
    <section className="bg-gradient-to-r from-brand-900 to-brand-500 text-white py-16 px-4">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="text-4xl font-extrabold leading-tight mb-4">
          Transparent Prices. Verified Suppliers.<br />Faster Procurement.
        </h1>
        <p className="text-blue-200 text-lg mb-8 max-w-2xl mx-auto">
          India's B2B marketplace for construction materials — compare live prices across suppliers, order in minutes, and track deliveries in real time.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/auth/register" className="bg-accent-500 hover:bg-accent-600 text-white font-semibold px-8 py-3 rounded-xl text-sm transition-colors">
            Get Started Free
          </Link>
          <Link href="/products" className="bg-white/10 hover:bg-white/20 text-white font-semibold px-8 py-3 rounded-xl text-sm transition-colors">
            Browse Materials
          </Link>
        </div>
      </div>
    </section>
  );
}
