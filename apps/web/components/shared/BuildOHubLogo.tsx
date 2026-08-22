import Link from "next/link";

// Shared BuildOHub wordmark — the single source of truth for the brand
// logo everywhere it appears (marketing header, mobile drawer, auth pages,
// builder sidebar/nav, footer, dashboards, …). Always renders the exact
// text "BuildOHub" as one continuous word: "Build"/"Hub" in the app's
// charcoal foreground token (--posh-fg) and "O" in the olive brand accent
// (--posh-olive) — never a separate image/logo asset, and never a
// different spelling/casing.
//
// `href` defaults to "/" (linking home); pass `href={null}` to render the
// wordmark as plain text (no link) for surfaces where a link isn't wanted.
// `size` controls font-size — default 20px per the design system, with a
// `sm` variant for tightly-constrained layouts (e.g. compact mobile
// headers) where 20px doesn't fit.
type BuildOHubLogoProps = {
  href?: string | null;
  size?: "default" | "sm" | "lg";
  className?: string;
};

// "lg" (1.875rem / 30px) is used by larger standalone surfaces such as the
// centred auth-page wordmark, where the homepage/header's 20px default
// would read too small against the surrounding whitespace.
const FONT_SIZE: Record<NonNullable<BuildOHubLogoProps["size"]>, string> = {
  default: "20px",
  sm: "16px",
  lg: "1.875rem",
};

export default function BuildOHubLogo({ href = "/", size = "default", className = "" }: BuildOHubLogoProps) {
  const content = (
    <>
      Build<span style={{ color: "var(--posh-olive)" }}>O</span>Hub
    </>
  );

  const style: React.CSSProperties = {
    color: "var(--posh-fg)",
    fontSize: FONT_SIZE[size],
    letterSpacing: "-0.01em",
  };

  if (href === null) {
    return (
      <span className={`posh-heading ${className}`} style={style}>
        {content}
      </span>
    );
  }

  return (
    <Link href={href} className={`posh-heading shrink-0 ${className}`} style={style}>
      {content}
    </Link>
  );
}
