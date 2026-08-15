import Link from "next/link";

const CHAPTERS = [
  {
    n: "01",
    title: "Discover",
    body: "A living index of material prices, updated through the day from suppliers who actually deliver.",
  },
  {
    n: "02",
    title: "Decide",
    body: "Compare landed cost, lead time and grade side by side. No calls, no chasing, no guesswork.",
  },
  {
    n: "03",
    title: "Deliver",
    body: "Place the order and follow it to site — dispatch, weighbridge, gate entry, all in one thread.",
  },
];

const STATS: [string, string][] = [
  ["1,200+", "Verified suppliers"],
  ["48 hrs",  "Median delivery"],
  ["₹0",      "Platform fee"],
];

// Lovable-inspired editorial sections that follow the hero + category grid.
// Server component — no client state needed.
export default function HomeEditorialSections() {
  return (
    <>
      {/* ── Three editorial chapters ── */}
      <section className="border-y" style={{ borderColor: "var(--posh-border)" }}>
        <div className="mx-auto max-w-7xl">
          <div
            className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0"
            style={{ borderColor: "var(--posh-border)" }}
          >
            {CHAPTERS.map((c) => (
              <article
                key={c.n}
                className="group p-10 transition-colors duration-500 hover:bg-[var(--posh-bg-card)] md:p-12"
                style={{ background: "var(--posh-bg)" }}
              >
                <span
                  className="text-xs tracking-[0.3em] uppercase"
                  style={{ color: "var(--posh-primary)" }}
                >
                  {c.n}
                </span>
                <h3
                  className="posh-heading mt-8 text-3xl"
                  style={{ color: "var(--posh-fg)" }}
                >
                  {c.title}
                </h3>
                <p className="mt-4 leading-relaxed" style={{ color: "var(--posh-fg-muted)" }}>
                  {c.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Editorial split — stats ── */}
      <section className="mx-auto max-w-7xl px-6 py-28 md:px-10 md:py-40">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
          {/* Left: editorial material photograph — the same asset used by
              the Lovable design (src/assets/materials.jpg → copied to
              public/images/materials.jpg). Native 1200x1504 (3:4 portrait);
              object-cover + a fixed responsive height preserves the crop
              without overflow at any breakpoint. Matches Lovable's ordering:
              image first (left), copy + stats second (right). */}
          <div className="overflow-hidden rounded-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/materials.jpg"
              alt="Stacked cement bags and steel rebar"
              width={1200}
              height={1504}
              loading="lazy"
              className="h-[26rem] w-full object-cover transition-transform duration-[1200ms] hover:scale-105 sm:h-[32rem] md:h-[40rem]"
            />
          </div>

          {/* Right: copy + stats */}
          <div>
            <h2
              className="posh-heading"
              style={{ fontSize: "clamp(2rem,4vw,3.25rem)", color: "var(--posh-fg)" }}
            >
              Every grade, every load, accounted for.
            </h2>
            <p className="mt-6 max-w-md leading-relaxed" style={{ color: "var(--posh-fg-muted)" }}>
              Cement, TMT, aggregates, blocks, formwork and finishes — sourced from suppliers we
              audit, priced at the rate you were quoted, delivered on the day you were promised.
            </p>
            <dl
              className="mt-12 grid grid-cols-3 gap-6 border-t pt-8"
              style={{ borderColor: "var(--posh-border)" }}
            >
              {STATS.map(([k, v]) => (
                <div key={v}>
                  <dt className="posh-heading text-3xl" style={{ color: "var(--posh-primary)" }}>{k}</dt>
                  <dd className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>

        </div>
      </section>

      {/* ── Cream closing CTA ── */}
      <section
        id="enquire"
        style={{ background: "var(--posh-cream)", color: "var(--posh-cream-fg)" }}
      >
        <div className="mx-auto max-w-7xl px-6 py-28 text-center md:px-10 md:py-40">
          <h2
            className="posh-heading mx-auto max-w-3xl"
            style={{ fontSize: "clamp(2.25rem,5.5vw,4.5rem)", color: "var(--posh-cream-fg)" }}
          >
            Tell us what your site needs this week.
          </h2>
          <div className="mx-auto mt-12 flex max-w-xl flex-col gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/newdashboard"
              className="flex min-h-[52px] items-center justify-center rounded-full px-10 py-4 text-sm font-medium transition-opacity hover:opacity-85"
              style={{ background: "var(--posh-cream-fg)", color: "var(--posh-cream)" }}
            >
              Get started free
            </Link>
            <Link
              href="/products"
              className="flex min-h-[52px] items-center justify-center rounded-full border px-10 py-4 text-sm font-medium transition-opacity hover:opacity-70"
              style={{ borderColor: "rgba(28,24,16,0.2)", color: "var(--posh-cream-fg)" }}
            >
              Browse materials
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-6 py-10 text-sm md:flex-row md:px-10"
        style={{ color: "var(--posh-fg-muted)", borderTop: "1px solid var(--posh-border)" }}
      >
        <span className="posh-heading text-lg" style={{ color: "var(--posh-fg)" }}>Buildohub</span>
        <span>© {new Date().getFullYear()} Buildohub · Coimbatore, India</span>
      </footer>
    </>
  );
}
