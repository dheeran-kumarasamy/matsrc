/** @type {import('next').NextConfig} */
const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "production",
  register: true,
  skipWaiting: true,
});

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@matsrc/ui", "@matsrc/db"],
  experimental: {
    // Ensure Prisma query engine binaries are included in Vercel serverless output.
    outputFileTracingIncludes: {
      "/*": [
        "../../node_modules/.prisma/client/**/*",
        "../../node_modules/@prisma/client/**/*",
        "../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*",
        "../../node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/**/*",
      ],
    },
    // pdfkit (used by the builder PO/invoice PDF export routes) resolves its
    // standard font data at runtime via Node's `module.createRequire()` +
    // its own package.json `imports` map (`#standard-fonts/*`), keyed off
    // `__filename` of pdfkit's own module file. When webpack bundles the
    // route handler into a single server chunk, `__filename` no longer
    // points at pdfkit's real location inside node_modules, so that
    // self-require fails at request time and the route throws — surfacing
    // as a generic 500 on GET .../export?format=pdf (and the equivalent
    // invoice PDF route). Excluding pdfkit from server bundling keeps it as
    // a plain native `require()` from its real on-disk location instead.
    serverComponentsExternalPackages: ["pdfkit"],
  },
  images: {
    domains: ["matsrc-docs.s3.ap-south-1.amazonaws.com"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = withPWA(nextConfig);
