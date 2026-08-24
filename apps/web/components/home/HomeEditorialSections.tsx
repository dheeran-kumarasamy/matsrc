import WhyChooseUs from "@/components/home/WhyChooseUs";
import BuildOHubLogo from "@/components/shared/BuildOHubLogo";

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
      {/* ── Why choose us (Buyer/Supplier toggle) ── replaces the previous
          static "Discover / Decide / Deliver" three-chapter section. See
          WhyChooseUs.tsx for the client-side role toggle. */}
      <WhyChooseUs />

      {/* ── Editorial split — stats ── */}
      <section className="mx-auto max-w-7xl px-6 py-28 md:px-10 md:py-40">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
          {/* Left: editorial material photograph — the same asset used by
              the Lovable design (src/assets/materials.jpg → copied to
              public/images/materials.jpg). Native 1200x1504 (3:4 portrait);
              object-cover + a fixed responsive height preserves the crop
              without overflow at any breakpoint. Matches Lovable's ordering:
              image first (left), copy + stats second (right). */}
          {/* Displayed at 50% of its previous rendered size (each height
              breakpoint halved: 26rem/32rem/40rem → 13rem/16rem/20rem) via
              CSS only — the source image and its aspect ratio/object-fit
              are untouched, so it scales down without stretching or
              distortion. Wrapped so it doesn't force the grid column wider
              than the smaller image needs. */}
          <div className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl md:mx-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/materials.jpg"
              alt="Stacked cement bags and steel rebar"
              width={1200}
              height={1504}
              loading="lazy"
              className="h-[13rem] w-full object-cover transition-transform duration-[1200ms] hover:scale-105 sm:h-[16rem] md:h-[20rem]"
            />
          </div>

          {/* Right: copy + stats */}
          <div>
            <h2
              className="posh-heading"
              style={{ fontSize: "clamp(1.2rem,2.4vw,1.95rem)", color: "var(--posh-fg)" }}
            >
              Quality and Quantity Assurance
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

      {/* ── Footer ── */}
      <footer
        className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-6 py-10 text-sm md:flex-row md:px-10"
        style={{ color: "var(--posh-fg-muted)", borderTop: "1px solid var(--posh-border)" }}
      >
        <BuildOHubLogo href={null} className="text-lg" />
        <span>© {new Date().getFullYear()} BuildOHub · Coimbatore, India</span>
      </footer>
    </>
  );
}
