import { BadgeCheck, LineChart, ShieldCheck } from "lucide-react";

// B2B trust banner — a subtle grid row directly below the hero, signalling
// the platform's core credibility pillars. Purely presentational (no data
// fetch), matching the same trio already substantiated elsewhere on the
// site: verified suppliers (CategoryGrid/ProductCard supplier badges),
// live/real-time pricing (Live Price Scroller, price intelligence), and
// secure B2B transactions (auth + order flow). No fabricated stats — copy
// only. Top padding is intentionally tight so this bar reads as part of the
// same interaction zone as the hero's search row directly above it.
const BADGES = [
  { icon: BadgeCheck, label: "Verified Suppliers" },
  { icon: LineChart, label: "Real-time Pricing" },
  { icon: ShieldCheck, label: "Secure B2B Transactions" },
];

export default function TrustBanner() {
  return (
    <section
      className="border-y pb-8 pt-5 md:pt-6"
      style={{ borderColor: "var(--posh-border)", background: "var(--posh-cream)" }}
    >
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 sm:grid-cols-3 md:px-10">
        {BADGES.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center justify-center gap-3 sm:justify-start">
            <Icon size={20} style={{ color: "var(--posh-primary)" }} aria-hidden />
            <span className="text-sm font-semibold" style={{ color: "var(--posh-cream-fg)" }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
