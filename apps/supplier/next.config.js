/** @type {import('next').NextConfig} */
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
        // pdfkit (used by the supplier PO PDF export route) resolves its
        // standard font (.cjs) and font-metric/ICC profile (data/*.afm,
        // data/*.icc) assets dynamically at runtime via its own package.json
        // #imports map + module.createRequire() — the exact same mechanism
        // that required apps/api's Vercel `includeFiles` fix (see
        // apps/api/vercel.json). Next.js's own output-file-tracer never
        // discovers these dynamically-required files either, so without
        // this they're silently dropped from the deployed serverless
        // function bundle and the PO PDF export route 500s in production
        // with "Cannot find module '.../pdfkit/js/standard-fonts/Helvetica.cjs'"
        // — identical root cause to the apps/api incident, just surfacing
        // via Next's tracer instead of Vercel's generic Node function one.
        "../../node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/standard-fonts/**/*",
        "../../node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/data/**/*",
      ],
    },
    // pdfkit (used by the supplier PO PDF export route) resolves its
    // standard font data at runtime via Node's `module.createRequire()` +
    // its own package.json `imports` map (`#standard-fonts/*`), keyed off
    // `__filename` of pdfkit's own module file. When webpack bundles the
    // route handler into a single server chunk, `__filename` no longer
    // points at pdfkit's real location inside node_modules, so that
    // self-require fails at request time and the route throws — surfacing
    // as a generic 500 on GET .../export?format=pdf. Excluding pdfkit from
    // server bundling keeps it as a plain native `require()` from its real
    // on-disk location instead. Mirrors apps/web/next.config.js.
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

module.exports = nextConfig;