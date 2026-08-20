import PriceTicker from "@/components/home/PriceTicker";
import SiteHeader from "@/components/home/SiteHeader";
import HeroSection from "@/components/home/HeroSection";
import CategoryGrid from "@/components/home/CategoryGrid";
import QuickRequestForm from "@/components/cart/QuickRequestForm";
import HomeEditorialSections from "@/components/home/HomeEditorialSections";

export default function HomePage() {
  return (
    <main
      // theme-home scopes the Home page's dark warm-brown editorial palette
      // to this subtree only (see the THEME ARCHITECTURE note in
      // app/globals.css) — every other route now renders the lighter warm
      // brown/beige "application" theme by default, matching /newdashboard.
      className="theme-home overflow-x-hidden"
      style={{ background: "var(--posh-bg)", color: "var(--posh-fg)" }}
    >
      {/* Fixed frosted nav — overlays the hero */}
      <SiteHeader />

      {/* Full-screen editorial hero (with the Lovable hero.jpg backdrop) */}
      <HeroSection />

      {/* FR-24: Live price ticker for top 10 materials.
          Positioned per the Lovable design: a static, full-bleed band
          directly BELOW the hero and ABOVE the rest of the page content
          (previously it sat above the header, which did not match). */}
      <PriceTicker />

      {/* Categories from real API data */}
      <CategoryGrid />

      {/* Editorial chapters, stats, CTA, footer */}
      <HomeEditorialSections />

      {/* FR-32: Floating Quick Request Form */}
      <QuickRequestForm floating />
    </main>
  );
}


