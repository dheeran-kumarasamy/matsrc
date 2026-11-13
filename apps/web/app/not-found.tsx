import Link from "next/link";
import BuildOHubLogo from "@/components/shared/BuildOHubLogo";

export const metadata = {
  title: "Page Not Found | BuildOHub",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center p-4 text-center"
      style={{ background: "var(--posh-bg)" }}
    >
      <div className="w-full max-w-md space-y-6">
        <BuildOHubLogo size="lg" className="inline-block" />

        <div
          className="rounded-3xl p-8 shadow-sm"
          style={{
            background: "var(--posh-bg-card)",
            border: "1px solid var(--posh-border)",
            color: "var(--posh-fg)",
          }}
        >
          <p className="posh-eyebrow text-xs uppercase tracking-widest text-slate-500">404 Error</p>
          <h1 className="posh-page-title mt-2 text-2xl font-bold">This page could not be found</h1>
          <p className="posh-muted mt-3 text-sm">
            The material, product, or page you requested does not exist, has been removed, or is temporarily unavailable.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/products"
              className="posh-btn inline-flex items-center justify-center px-6 py-2.5 text-sm font-semibold"
            >
              Browse Materials
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--posh-border)] px-6 py-2.5 text-sm font-semibold transition hover:bg-[rgba(var(--posh-wash-rgb),0.05)]"
              style={{ color: "var(--posh-fg)" }}
            >
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
