import PriceTicker from "@/components/home/PriceTicker";
import SiteHeader from "@/components/home/SiteHeader";
import HeroSection from "@/components/home/HeroSection";
import CategoryGrid from "@/components/home/CategoryGrid";
import QuickRequestForm from "@/components/cart/QuickRequestForm";
import HomeEditorialSections from "@/components/home/HomeEditorialSections";

export default function HomePage() {
  return (
    <main
      className="overflow-x-hidden"
      style={{ background: "var(--posh-bg)", color: "var(--posh-fg)" }}
    >
      {/* FR-24: Live price ticker for top 10 materials */}
      <PriceTicker />

      {/* Fixed frosted nav — overlays the hero */}
      <SiteHeader />

      {/* Full-screen editorial hero */}
      <HeroSection />

      {/* Categories from real API data */}
      <CategoryGrid />

      {/* Editorial chapters, stats, CTA, footer */}
      <HomeEditorialSections />

      {/* FR-32: Floating Quick Request Form */}
      <QuickRequestForm floating />
    </main>
  );
}


