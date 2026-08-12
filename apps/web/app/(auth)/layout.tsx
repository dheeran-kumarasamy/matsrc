import Link from "next/link";

// Auth layout — Posh editorial design: dark warm background,
// centred card with cream tones. All form logic/routes unchanged.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: "var(--posh-bg)" }}
    >
      <div className="w-full max-w-md">
        {/* Wordmark */}
        <div className="mb-10 text-center">
          <Link href="/" className="posh-heading inline-block text-3xl" style={{ color: "var(--posh-fg)" }}>
            Buildohub
          </Link>
          <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>
            B2B Construction Material Marketplace
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-3xl p-8 shadow-2xl"
          style={{
            background: "var(--posh-bg-card)",
            border: "1px solid var(--posh-border)",
            color: "var(--posh-fg)",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

