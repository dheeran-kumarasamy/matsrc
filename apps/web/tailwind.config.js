const baseConfig = require("@matsrc/config/tailwind.config");

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...baseConfig,
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    ...baseConfig.theme,
    extend: {
      ...baseConfig.theme?.extend,
      // "Pricing desk" surface palette — used only by the Builder price
      // report page (apps/web/app/(builder)/products/[slug]/report). Kept
      // additive/scoped here rather than in shared config since no other
      // surface in the app should adopt this look. deskYellow is reserved
      // exclusively for the Buy/Hold/Wait signal card per the design spec.
      colors: {
        ...baseConfig.theme?.extend?.colors,
        deskBg: "#E7E5E0",
        deskSteel: "#2B4C6F",
        deskInk: "#1C1F26",
        deskYellow: "#F5C400",
      },
      fontFamily: {
        ...baseConfig.theme?.extend?.fontFamily,
        deskMono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        // Editorial display face used by the posh-web-flair design system
        // (github.com/dheeran-kumarasamy/posh-web-flair → --font-display).
        // Loaded via the Google Fonts import at the top of app/globals.css.
        display: ["Instrument Serif", "Georgia", "serif"],
      },
      borderRadius: {
        ...baseConfig.theme?.extend?.borderRadius,
        // posh-web-flair uses --radius: 1.5rem with a rounded-4xl step on
        // its report surfaces (calc(var(--radius) + 16px) = 2.5rem).
        "4xl": "2.5rem",
      },
      keyframes: {
        marquee: { "0%": { transform: "translateX(0%)" }, "100%": { transform: "translateX(-50%)" } },
        deskReveal: { "0%": { opacity: "0", transform: "translateY(4px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        marquee: "marquee 30s linear infinite",
        deskReveal: "deskReveal 0.4s ease-out",
      },
    },
  },

  plugins: [...(baseConfig.plugins || []), require("tailwindcss-animate")],
};

