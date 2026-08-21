import Link from "next/link";

// Hero — Charcoal / Olive / White redesign:
// - Single-line headline "Procurement made easy" (charcoal + olive italic
//   lowercase "made easy"), sized down + wider letter spacing per the latest
//   design pass
// - Background photograph at ~50% less overlay strength than before, so the
//   image reads as a real visual element instead of a faded backdrop
// - "Get started for Free" (olive) + "Browse materials" (charcoal) now sit
//   as a compact button row directly below the search bar
// - min-h-[80vh] removed in favour of content-driven padding so the large
//   empty gap below the CTAs/trust bar (previously caused by vertically
//   centering short content inside an 80vh box) is eliminated instead of
//   masked with negative margins
export default function HeroSection() {
  return (
    <section
      className="relative flex items-center overflow-hidden"
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
          deliberately small so the CTAs sit close to the Verified Suppliers
          trust bar immediately below (see whitespace-reduction note above). */}
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-6 pb-6 pt-16 text-center md:px-10 md:pb-8">
        {/* Eyebrow */}
        <p
          className="mb-6 text-xs font-bold uppercase tracking-[0.35em]"
          style={{ color: "var(--posh-olive)" }}
        >
          Materials · India
        </p>

        {/* Main headline — "Procurement made easy" on one line on desktop:
            charcoal "Procurement" + lowercase italic olive "made easy".
            Sized to ~60% of the previous rendered size (was
            text-4xl/5xl/6xl → 2.25/3/3.75rem; now 1.35/1.8/2.25rem) with
            letter-spacing opened up to read clearly at the smaller size
            (~1.2x more open than the previous tracking-tight treatment).
            Wrapping is only allowed on narrow mobile widths where it's
            required to avoid overflow. */}
        <h1
          className="max-w-full whitespace-normal font-extrabold leading-[1.15] md:whitespace-nowrap"
          style={{ fontSize: "clamp(1.35rem, 1.05rem + 1.4vw, 2.25rem)", letterSpacing: "0.012em" }}
        >
          <span style={{ color: "var(--posh-fg)" }}>Procurement </span>
          <span className="italic lowercase" style={{ color: "var(--posh-olive)" }}>made easy</span>
        </h1>

        <p
          className="mt-6 max-w-xl text-base leading-relaxed md:text-lg"
          style={{ color: "var(--posh-fg-muted)" }}
        >
          Live prices, verified suppliers, and tracked deliveries — one place
          to procure cement, steel, and aggregates across India.
        </p>

        {/* Search bar */}
        <form
          action="/products"
          method="GET"
          role="search"
          className="mt-8 flex w-full max-w-2xl items-center gap-2 rounded-2xl border bg-white p-2"
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
            className="posh-invert-hover flex min-h-[48px] shrink-0 items-center justify-center rounded-xl border px-6 text-sm font-bold transition-colors duration-200"
            style={{
              background: "var(--posh-olive)",
              color: "var(--posh-olive-fg)",
              borderColor: "var(--posh-olive)",
              "--posh-hover-bg": "var(--posh-olive-fg)",
              "--posh-hover-color": "var(--posh-olive)",
            } as React.CSSProperties}
          >
            Search
          </button>
        </form>

        {/* CTA row — "Get started for Free" (olive) + "Browse materials"
            (charcoal), directly below the search bar, sized to fit their
            text rather than stretching full-width. */}
        <div className="mt-4 flex w-full max-w-2xl flex-wrap items-center justify-center gap-3">
          <Link
            href="/auth/register"
            className="posh-invert-hover inline-flex items-center justify-center rounded-md border px-5 py-2.5 text-sm font-semibold transition-colors duration-200"
            style={{
              background: "var(--posh-olive)",
              color: "var(--posh-olive-fg)",
              borderColor: "var(--posh-olive)",
              "--posh-hover-bg": "var(--posh-olive-fg)",
              "--posh-hover-color": "var(--posh-olive)",
            } as React.CSSProperties}
          >
            Get started for Free
          </Link>
          <Link
            href="/products"
            className="posh-invert-hover inline-flex items-center justify-center rounded-md border px-5 py-2.5 text-sm font-semibold transition-colors duration-200"
            style={{
              background: "var(--posh-fg)",
              color: "#ffffff",
              borderColor: "var(--posh-fg)",
              "--posh-hover-bg": "#ffffff",
              "--posh-hover-color": "var(--posh-fg)",
            } as React.CSSProperties}
          >
            Browse materials
          </Link>
        </div>
      </div>
    </section>
  );
}

