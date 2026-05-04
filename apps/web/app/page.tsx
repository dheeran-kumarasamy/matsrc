import Link from "next/link";
import PriceTicker from "@/components/home/PriceTicker";
import HeroSection from "@/components/home/HeroSection";
import CategoryGrid from "@/components/home/CategoryGrid";
import QuickRequestForm from "@/components/cart/QuickRequestForm";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      {/* FR-24: Live price ticker for top 10 materials */}
      <PriceTicker />

      {/* Navigation */}
      <nav className="bg-brand-500 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            Build<span className="text-accent-500">Mart</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/products" className="text-sm hover:text-accent-500 transition-colors">
              Browse Materials
            </Link>
            <Link href="/auth/login" className="text-sm bg-accent-500 hover:bg-accent-600 px-4 py-2 rounded-md font-medium transition-colors">
              Login / Register
            </Link>
          </div>
        </div>
      </nav>

      <HeroSection />
      <CategoryGrid />

      {/* FR-32: Floating Quick Request Form */}
      <QuickRequestForm floating />
    </main>
  );
}
