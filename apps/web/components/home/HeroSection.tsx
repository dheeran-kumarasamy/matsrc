import Link from "next/link";

export default function HeroSection() {
  return (
    <section className="bg-gradient-to-r from-brand-900 to-brand-500 text-white py-12 px-4 sm:py-16 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="text-3xl font-bold leading-tight mb-4 md:text-5xl lg:text-6xl">
          Transparent Prices. Verified Suppliers.<br />Faster Procurement.
        </h1>
        <p className="text-blue-200 text-base mb-8 max-w-2xl mx-auto sm:text-lg">
          India's B2B marketplace for construction materials — compare live prices across suppliers, order in minutes, and track deliveries in real time.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/auth/register"
            className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-accent-500 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-600 sm:w-auto"
          >
            Get Started Free
          </Link>
          <Link
            href="/products"
            className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-white/10 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/20 sm:w-auto"
          >
            Browse Materials
          </Link>
        </div>
      </div>
    </section>
  );
}
