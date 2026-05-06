/** @type {import('next').NextConfig} */
const withPWA = require("next-pwa")({
  dest: "public",
  disable: true,
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

module.exports = withPWA(nextConfig);
