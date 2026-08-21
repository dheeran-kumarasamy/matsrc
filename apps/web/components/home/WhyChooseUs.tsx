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
    <section className="border-y" style={{ borderColor: "var(--posh-border)", background: "var(--posh-bg)" }}>
      <div className="mx-auto max-w-7xl px-6 py-16 md:px-10 md:py-20">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div>
            <p
              className="text-xs font-bold uppercase tracking-[0.35em]"
              style={{ color: "var(--posh-olive)" }}
            >
              Why Buildohub
            </p>
            <h2
              className="posh-heading mt-4 max-w-2xl text-2xl md:text-3xl"
              style={{ color: "var(--posh-fg)" }}
            >
              Built for buyers. Built for suppliers.
            </h2>
          </div>

          {/* Buyer / Supplier pill toggle */}
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
                  className="rounded-full px-6 py-2.5 text-sm font-medium capitalize transition-colors duration-200"
                  style={{
                    background: active ? "var(--posh-olive)" : "transparent",
                    color: active ? "var(--posh-olive-fg)" : "var(--posh-fg-muted)",
                  }}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {activeCards.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="group rounded-3xl border p-8 transition-all duration-300 hover:-translate-y-1"
              style={{ borderColor: "var(--posh-border)", background: "var(--posh-bg-card)" }}
            >
              <div
                className="flex h-14 w-14 items-center justify-center rounded-full border transition-colors duration-300"
                style={{ borderColor: "var(--posh-border)" }}
              >
                <Icon
                  className="h-6 w-6 transition-colors duration-300"
                  style={{ color: "var(--posh-olive)" }}
                  aria-hidden
                />
              </div>
              <h3 className="posh-heading mt-8 text-xl" style={{ color: "var(--posh-fg)" }}>
                {title}
              </h3>
              <p className="mt-3 leading-relaxed" style={{ color: "var(--posh-fg-muted)" }}>
                {body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
