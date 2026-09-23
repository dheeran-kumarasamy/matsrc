import Image from "next/image";
import Link from "next/link";

// Shared BuildOHub wordmark — the single source of truth for the brand
// logo everywhere it appears (marketing header, mobile drawer, auth pages,
// builder sidebar/nav, footer, dashboards, …). Renders the official
// "logo-full.png" artwork (apps/web/public/icons/logo-full.png — the same
// asset used by the admin and supplier apps) via next/image, so every
// surface stays in sync with a single image file instead of a hand-rolled
// text/CSS reproduction that can drift out of date (e.g. missing the
// ".in" suffix in the current mark).
//
// `href` defaults to "/" (linking home); pass `href={null}` to render the
// wordmark without a link for surfaces where a link isn't wanted.
// `size` controls the rendered height — default 28px, with `sm` (22px) for
// tightly-constrained layouts (e.g. compact mobile headers) and `lg` (42px)
// for larger standalone surfaces such as the centred auth-page wordmark.
type BuildOHubLogoProps = {
  href?: string | null;
  size?: "default" | "sm" | "lg";
  className?: string;
};

const HEIGHT: Record<NonNullable<BuildOHubLogoProps["size"]>, number> = {
  default: 28,
  sm: 22,
  lg: 42,
};

// Source artwork is 1600x736px — preserve that aspect ratio at every size
// so the mark never stretches or distorts.
const ASPECT_RATIO = 1600 / 736;

export default function BuildOHubLogo({ href = "/", size = "default", className = "" }: BuildOHubLogoProps) {
  const height = HEIGHT[size];
  const width = Math.round(height * ASPECT_RATIO);

  const content = (
    <Image
      src="/icons/logo-full.png"
      alt="BuildOhub.in"
      width={width}
      height={height}
      style={{ height, width: "auto" }}
      priority
    />
  );

  if (href === null) {
    return (
      <span className={`inline-flex shrink-0 items-center ${className}`}>
        {content}
      </span>
    );
  }

  return (
    <Link href={href} className={`inline-flex shrink-0 items-center ${className}`}>
      {content}
    </Link>
  );
}

