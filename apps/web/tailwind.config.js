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
      // surface in the app should adopt this look.
      //
      // These tokens are now MONOCHROME so the price desk matches the
      // site-wide black & white palette: ink and the "steel" accent are both
      // pure black, the surface is off-white, and deskYellow (the Buy/Hold/
      // Wait signal card) is a light grey chip that keeps black text legible.
      colors: {
        ...baseConfig.theme?.extend?.colors,
        deskBg: "#F2F2F2",
        deskSteel: "#000000",
        deskInk: "#000000",
        deskYellow: "#E3E3E3",
      },
      fontFamily: {
        ...baseConfig.theme?.extend?.fontFamily,
        deskMono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        // Industrial redesign — a single modern sans-serif (Inter) replaces
        // the previous Instrument Serif editorial display face everywhere,
        // including anywhere `font-display` was used. Loaded via the
        // Google Fonts import at the top of app/globals.css.
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
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

