import Link from "next/link";

// Hero — Charcoal / Olive / White redesign:
// - Single-line headline "Procurement, Made Easy." (charcoal + olive italic)
// - Background photograph at ~50% less overlay strength than before, so the
//   image reads as a real visual element instead of a faded backdrop
// - "Get a Bulk Quote" removed; "Browse Material" now sits directly beside
//   the search bar as a secondary action, both on one row on desktop
// - Reduced spacing to the Verified Suppliers trust bar immediately below
export default function HeroSection() {
  return (
    <section
      className="relative flex min-h-[80vh] items-center overflow-hidden"
      style={{ background: "var(--posh-bg)" }}
    >
      {/* Hero background photograph. Previous opacity (0.25) reduced by
          ~50% relative overlay strength — i.e. the image is now roughly
          twice as visible — while the gradient below still keeps the
          centered content readable. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/hero.jpg"
        alt="Steel frame of a building under construction at golden hour"
        width={1920}
        height={1200}
        className="absolute inset-0 h-full w-full object-cover opacity-45"
      />

      {/* Charcoal-to-offwhite gradient overlay — overlay strength reduced by
          ~50% (0.55 → 0.28 top alpha) from the previous treatment so the
          photograph is significantly more visible, while still keeping the
          headline/search area legible near the bottom. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(248,250,252,0.28) 0%, var(--posh-bg) 92%)",
        }}
      />

      {/* Content — centered, tighter vertical rhythm. Bottom padding is
          deliberately smaller than the top so the search row sits close to
          the Verified Suppliers trust bar immediately below, making the
          two feel like one interaction zone rather than separate sections. */}
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-6 pb-8 pt-16 text-center md:px-10 md:pb-10">
        {/* Eyebrow */}
        <p
          className="mb-6 text-xs font-bold uppercase tracking-[0.35em]"
          style={{ color: "var(--posh-olive)" }}
        >
          Materials · India
        </p>

        {/* Main headline — one line on desktop: charcoal "Procurement," +
            olive italic "Made Easy." Wrapping is only allowed on narrow
            mobile widths where it's required to avoid overflow (both
            spans keep their colour/italic styling if that happens). */}
        <h1 className="max-w-full whitespace-normal text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl md:whitespace-nowrap md:text-6xl">
          <span style={{ color: "var(--posh-fg)" }}>Procurement, </span>
          <span className="italic" style={{ color: "var(--posh-olive)" }}>Made Easy.</span>
        </h1>

        <p
          className="mt-6 max-w-xl text-base leading-relaxed md:text-lg"
          style={{ color: "var(--posh-fg-muted)" }}
        >
          Live prices, verified suppliers, and tracked deliveries — one place
          to procure cement, steel, and aggregates across India.
        </p>

        {/* Search bar + Browse Material — one row on desktop, search is the
            dominant element and Browse Material is a compact secondary
            action immediately to its right. */}
        <div className="mt-8 flex w-full max-w-2xl flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <form
            action="/products"
            method="GET"
            role="search"
            className="flex flex-1 items-center gap-2 rounded-2xl border bg-white p-2"
            style={{ borderColor: "var(--posh-border)", boxShadow: "var(--posh-shadow-elevated)" }}
          >
            <input
              type="search"
              name="q"
              aria-label="Search materials, suppliers or grades"
              placeholder="Search cement, TMT bars, aggregates…"
              className="min-h-[48px] flex-1 rounded-xl border-0 bg-transparent px-4 text-sm outline-none"
              style={{ color: "var(--posh-fg)" }}
            />
            <button
              type="submit"
              className="flex min-h-[48px] shrink-0 items-center justify-center rounded-xl px-6 text-sm font-bold transition-colors hover:opacity-90"
              style={{ background: "var(--posh-olive)", color: "var(--posh-olive-fg)" }}
            >
              Search
            </button>
          </form>

          {/* Secondary action — compact, vertically aligned with the search
              bar, deliberately less prominent than the search function. */}
          <Link
            href="/products"
            className="flex min-h-[48px] shrink-0 items-center justify-center rounded-2xl border px-6 text-sm font-semibold transition-colors hover:bg-white"
            style={{
              borderColor: "var(--posh-border)",
              color: "var(--posh-fg)",
              background: "rgba(var(--posh-wash-rgb),0.03)",
            }}
          >
            Browse Material
          </Link>
        </div>
      </div>
    </section>
  );
}

