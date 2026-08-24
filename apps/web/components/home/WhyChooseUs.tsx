"use client";

import { useState } from "react";
import {
  BarChart3,
  Building2,
  Layers,
  MapPin,
  Sparkles,
  Tag,
  Users,
  Wallet,
} from "lucide-react";

// "Why choose us" — Buyer/Supplier toggle section, adapted from the
// posh-web-flair reference design (github.com/dheeran-kumarasamy/posh-web-flair)
// to this codebase's Charcoal/Olive/White token system (--posh-*) instead of
// the reference's shadcn/oklch theme. Replaces the previous static
// "Discover / Decide / Deliver" three-chapter section.
//
// Copy has been adapted from the reference repo to remove unverified
// numeric/marketing claims (e.g. a specific "% below market price" figure,
// a specific "invoice financing" product) while keeping the same four
// themes and icons per role.
const WHY_CHOOSE_US = {
  buyer: [
    {
      icon: Tag,
      title: "Get lower prices",
      body: "Benchmark live rates across verified suppliers and negotiate quotes with full price transparency.",
    },
    {
      icon: Sparkles,
      title: "AI-assisted ordering",
      body: "Get recommendations on the right grade, quantity and reorder timing based on your project schedule.",
    },
    {
      icon: BarChart3,
      title: "Comprehensive reports",
      body: "Track spend, price variance, supplier performance and site-wise consumption in one clean dashboard.",
    },
    {
      icon: Building2,
      title: "Multi-brand / multi-city",
      body: "Source cement, steel, aggregates and finishes from multiple brands, delivered to any site across India.",
    },
  ],
  supplier: [
    {
      icon: Users,
      title: "Verified buyers",
      body: "Access a curated network of contractors and developers actively buying construction materials.",
    },
    {
      icon: Wallet,
      title: "Faster payments",
      body: "Reduce working-capital stress with predictable, tracked payment cycles built for suppliers.",
    },
    {
      icon: MapPin,
      title: "Pan-India reach",
      body: "Expand beyond your local market with logistics and fulfilment support across India.",
    },
    {
      icon: Layers,
      title: "List your full catalogue",
      body: "List TMT, cement, blocks, sand, plywood and more — all in one integrated marketplace.",
    },
  ],
} as const;

export default function WhyChooseUs() {
  const [role, setRole] = useState<"buyer" | "supplier">("buyer");
  const activeCards = WHY_CHOOSE_US[role];

  return (
    /* Section separator border removed — visual hierarchy now comes from
       spacing/typography/background alone, for a fluid, continuous flow
       between homepage sections instead of a hard divider line. */
    <section style={{ background: "var(--posh-bg)" }}>
      <div className="mx-auto max-w-7xl px-6 pb-12 pt-10 md:px-10 md:pb-16 md:pt-12">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div>
            <p
              className="text-xs font-bold uppercase tracking-[0.35em]"
              style={{ color: "var(--posh-olive)" }}
            >
              Why BuildOHub
            </p>
            <h2
              className="posh-heading mt-4 max-w-2xl text-2xl md:text-3xl"
              style={{ color: "var(--posh-fg)" }}
            >
              Built for buyers. Built for suppliers.
            </h2>
          </div>

          {/* Buyer / Supplier pill toggle — the active pill is a charcoal
              button that flips to olive on hover/focus (same site-wide
              charcoal<->olive hover rule as every other button), via
              .posh-btn-charcoal. The inactive pill stays transparent/muted
              until it becomes active. */}
          <div
            className="flex rounded-full border p-1"
            style={{ borderColor: "var(--posh-border)", background: "var(--posh-bg-card)" }}
          >
            {(["buyer", "supplier"] as const).map((r) => {
              const active = role === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  aria-pressed={active}
                  // Compact pill sized to the short "buyer"/"supplier" label
                  // instead of oversized fixed padding.
                  className={
                    active
                      ? "posh-btn-charcoal rounded-full px-4 py-1.5 text-sm font-medium capitalize"
                      : "rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors duration-200"
                  }
                  style={active ? undefined : { background: "transparent", color: "var(--posh-fg-muted)" }}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>

        {/* Compact, content-sized cards on every breakpoint — icon + heading
            share one row (no icon-circle-then-large-gap stack), padding/gaps
            tightened throughout instead of only on mobile/tablet, and no
            fixed/min-height anywhere so each card is only as tall as its
            title + body text require. Two-in-a-row on mobile/tablet
            (grid-cols-2), four-in-a-row from lg: up. */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:mt-8 md:gap-4 lg:grid-cols-4">
          {activeCards.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="group rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-1"
              style={{ borderColor: "var(--posh-border)", background: "var(--posh-bg-card)" }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors duration-300"
                  style={{ borderColor: "var(--posh-border)" }}
                >
                  <Icon
                    className="h-4 w-4 transition-colors duration-300"
                    style={{ color: "var(--posh-olive)" }}
                    aria-hidden
                  />
                </div>
                <h3 className="posh-heading text-sm leading-snug md:text-base" style={{ color: "var(--posh-fg)" }}>
                  {title}
                </h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed md:text-sm" style={{ color: "var(--posh-fg-muted)" }}>
                {body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
