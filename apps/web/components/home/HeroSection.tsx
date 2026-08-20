import Link from "next/link";

// Hero — industrial redesign: minimalist, centered layout on a clean
// off-white/charcoal backdrop with a high-contrast orange primary CTA.
// All existing links/routes preserved (register / browse materials).
export default function HeroSection() {
  return (
    <section
      className="relative flex min-h-[85vh] items-center overflow-hidden"
      style={{ background: "var(--posh-bg)" }}
    >
      {/* Hero background photograph — same asset as before, now dimmed
          under a charcoal wash rather than a warm brown one so it reads
          as industrial rather than editorial. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/hero.jpg"
        alt="Steel frame of a building under construction at golden hour"
        width={1920}
        height={1200}
        className="absolute inset-0 h-full w-full object-cover opacity-25"
      />

      {/* Charcoal-to-offwhite gradient overlay — keeps the centered content
          legible against the photograph. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(248,250,252,0.55) 0%, var(--posh-bg) 92%)",
        }}
      />

      {/* Content — centered, generous vertical rhythm */}
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-24 text-center md:px-10">
        {/* Eyebrow */}
        <p
          className="mb-6 text-xs font-bold uppercase tracking-[0.35em]"
          style={{ color: "var(--posh-primary)" }}
        >
          Materials · India
        </p>

        {/* Main headline — bold Inter, strong hierarchy */}
        <h1
          className="max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl md:text-6xl"
          style={{ color: "var(--posh-fg)" }}
        >
          Procurement, built for speed.
        </h1>

        <p
          className="mt-6 max-w-xl text-base leading-relaxed md:text-lg"
          style={{ color: "var(--posh-fg-muted)" }}
        >
          Live prices, verified suppliers, and tracked deliveries — one place
          to procure cement, steel, and aggregates across India.
        </p>

        {/* Centered search bar — deep-links into the existing /products
            search, same pattern already used by the header search. */}
        <form
          action="/products"
          method="GET"
          role="search"
          className="mt-10 flex w-full max-w-xl items-center gap-2 rounded-2xl border bg-white p-2"
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
            style={{ background: "var(--posh-primary)", color: "var(--posh-primary-fg)" }}
          >
            Search
          </button>
        </form>

        {/* High-contrast CTA row */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* P0 fix: this previously linked straight to /newdashboard, which
              is an authenticated route — unregistered visitors clicking
              "Get a Bulk Quote" were bounced to a login wall instead of
              the registration funnel. Send them to /auth/register instead;
              an already-authenticated visitor is redirected on to
              /newdashboard automatically by middleware.ts's `/auth/*`
              handling, so this is safe for both logged-out and logged-in
              users. */}
          <Link
            href="/auth/register"
            className="flex min-h-[52px] items-center justify-center rounded-full px-10 py-3 text-sm font-bold uppercase tracking-wide transition-opacity hover:opacity-90"
            style={{
              background: "var(--posh-primary)",
              color: "var(--posh-primary-fg)",
              boxShadow: "var(--posh-shadow-elevated)",
            }}
          >
            Get a Bulk Quote
          </Link>
          <Link
            href="/products"
            className="flex min-h-[52px] items-center justify-center rounded-full border px-8 py-3 text-sm font-semibold transition-colors hover:bg-white"
            style={{
              borderColor: "var(--posh-border)",
              color: "var(--posh-fg)",
              background: "rgba(var(--posh-wash-rgb),0.03)",
            }}
          >
            Browse materials
          </Link>
        </div>
      </div>
    </section>
  );
}

