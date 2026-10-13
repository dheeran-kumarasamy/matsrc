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
        // pdfkit (used by the builder PO/invoice/advance-receipt PDF export
        // routes) resolves its standard font (.cjs) and font-metric/ICC
        // profile (data/*.afm, data/*.icc) assets dynamically at runtime via
        // its own package.json #imports map + module.createRequire() — the
        // exact same mechanism that required apps/api's Vercel
        // `includeFiles` fix (see apps/api/vercel.json). Next.js's own
        // output-file-tracer never discovers these dynamically-required
        // files either, so without this they're silently dropped from the
        // deployed serverless function bundle and every PDF download route
        // (purchase-orders/[id]/export, orders/[id]/invoice/pdf,
        // advance/receipts/[id]/pdf) 500s in production with
        // "Cannot find module '.../pdfkit/js/standard-fonts/Helvetica.cjs'"
        // — identical root cause to the apps/api incident, just surfacing
        // via Next's tracer instead of Vercel's generic Node function one.
        "../../node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/standard-fonts/**/*",
        "../../node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/data/**/*",
        // Custom embedded font (DejaVu Sans, subsetted) used by every PDF
        // render route in this app so the ₹ (U+20B9) rupee glyph actually
        // renders — pdfkit's built-in Standard 14 fonts (Helvetica etc.) only
        // cover WinAnsi/Latin-1 and silently drop non-ASCII glyphs like ₹.
        // Read at runtime via fs.readFileSync(path.join(process.cwd(), ...))
        // in lib/pdf-fonts.ts, which Next's output-file-tracer does not
        // reliably follow (same class of gap as the pdfkit asset issue
        // above), so it must be explicitly included here too.
        "lib/assets/fonts/**/*",
        // (apps/web/lib/assets/fonts/**/* above already covers the bold
        // variant, DejaVuSans-Bold.ttf, added for the supplier-facing
        // Purchase Order PDF's section headings/labels.)
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
    // NOTE: this alone is NOT sufficient in production — see the
    // outputFileTracingIncludes entries above for the second half of this
    // fix (the font/data assets must also be traced into the function
    // bundle, which webpack-externalizing pdfkit does not achieve on its
    // own).
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
