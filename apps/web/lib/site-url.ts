// site-url.ts — single source of truth for the app's canonical public
// origin, reused by both metadata (generateMetadata canonical URLs) and
// JSON-LD (absolute URLs are required there). Mirrors the same env
// convention already used server-side in lib/api.ts's getServerOrigin(),
// rather than inventing a second convention.
export function getSiteUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;

  if (!configured) {
    if (process.env.VERCEL_ENV === "preview") {
      throw new Error("NEXT_PUBLIC_APP_URL or VERCEL_URL must be configured in preview environment");
    }
    if (process.env.NODE_ENV !== "production") {
      return "http://localhost:3000";
    }
    return "https://buildohub.in";
  }

  return configured.startsWith("http") ? configured : `https://${configured}`;
}
