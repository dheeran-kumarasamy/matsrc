import Link from "next/link";

// Hero — Posh editorial design: full-screen dark section, content anchored
// at bottom-left, large Instrument Serif headline, warm gradient overlay.
// All existing links/routes preserved.
export default function HeroSection() {
  return (
    <section
      className="relative flex min-h-screen items-end overflow-hidden"
      style={{ background: "var(--posh-bg)" }}
    >
      {/* Warm gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, var(--posh-bg) 10%, transparent 55%), var(--posh-gradient-warm)",
        }}
      />

      {/* Content — anchored to bottom */}
      <div
        className="relative mx-auto w-full max-w-7xl px-6 pb-24 md:px-10 md:pb-32"
      >
        {/* Eyebrow */}
        <p
          className="animate-rise mb-8 text-xs uppercase tracking-[0.35em] font-medium"
          style={{ color: "var(--posh-primary)" }}
        >
          Materials · India
        </p>

        {/* Main headline */}
        <h1
          className="posh-heading animate-rise-delay-1 max-w-4xl"
          style={{
            fontSize: "clamp(2.75rem, 8vw, 7rem)",
            color: "var(--posh-fg)",
          }}
        >
          Procurement,{" "}
          <em className="italic" style={{ color: "var(--posh-primary)" }}>
            quietly
          </em>{" "}
          perfected.
        </h1>

        {/* Subheading + CTAs row */}
        <div className="animate-rise-delay-2 mt-10 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <p
            className="max-w-sm text-base leading-relaxed md:text-lg"
            style={{ color: "var(--posh-fg-muted)" }}
          >
            Live prices, verified suppliers, and tracked deliveries — one
            place to procure cement, steel, and aggregates across India.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/auth/register"
              className="flex min-h-[48px] items-center justify-center rounded-full px-8 py-3 text-sm font-medium transition-opacity hover:opacity-85"
              style={{
                background: "var(--posh-primary)",
                color: "var(--posh-primary-fg)",
              }}
            >
              Get started free
            </Link>
            <Link
              href="/products"
              className="flex min-h-[48px] items-center justify-center rounded-full border px-8 py-3 text-sm font-medium transition-colors hover:opacity-80"
              style={{
                borderColor: "var(--posh-border)",
                color: "var(--posh-fg)",
                background: "rgba(240,232,216,0.06)",
              }}
            >
              Browse materials
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

