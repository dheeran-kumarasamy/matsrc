import SiteHeader from "@/components/home/SiteHeader";
import HeroSection from "@/components/home/HeroSection";
import TrustBanner from "@/components/home/TrustBanner";
import CategoryGrid from "@/components/home/CategoryGrid";
import QuickRequestForm from "@/components/cart/QuickRequestForm";
import HomeEditorialSections from "@/components/home/HomeEditorialSections";

export default function HomePage() {
  return (
    <main
      // theme-home is now a no-op alias (see the THEME ARCHITECTURE note in
      // app/globals.css) — Home and every other route share one industrial
      // charcoal/orange/off-white palette, matching /newdashboard.
      className="theme-home overflow-x-hidden"
      style={{ background: "var(--posh-bg)", color: "var(--posh-fg)" }}
    >
      {/* Fixed frosted nav — overlays the hero. The Live Price Scroller now
          lives here (beside the logo, see SiteHeader.tsx), replacing the
          old full-width price ticker band that used to sit below the hero —
          it is intentionally not duplicated in both places. */}
      <SiteHeader />

      {/* Minimalist centered hero with search + Browse Material action */}
      <HeroSection />

      {/* B2B trust banner — Verified Suppliers / Real-time Pricing / Secure
          B2B Transactions, directly below the hero. */}
      <TrustBanner />

      {/* Categories from real API data */}
      <CategoryGrid />

      {/* Editorial chapters, stats, CTA, footer */}
      <HomeEditorialSections />

      {/* FR-32: Floating Quick Request Form */}
      <QuickRequestForm floating />
    </main>
  );
}


