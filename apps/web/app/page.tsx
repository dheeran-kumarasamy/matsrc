import PriceTicker from "@/components/home/PriceTicker";
import SiteHeader from "@/components/home/SiteHeader";
import HeroSection from "@/components/home/HeroSection";
import CategoryGrid from "@/components/home/CategoryGrid";
import QuickRequestForm from "@/components/cart/QuickRequestForm";

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      {/* FR-24: Live price ticker for top 10 materials */}
      <PriceTicker />

      {/* Responsive header: full inline nav at md+, burger + Sheet below md */}
      <SiteHeader />

      <HeroSection />
      <CategoryGrid />

      {/* FR-32: Floating Quick Request Form */}
      <QuickRequestForm floating />
    </main>
  );
}

