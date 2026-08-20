// shared tailwind config base
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Industrial redesign — deep charcoal/slate brand, construction
        // accent orange. Shared across web/admin/supplier via this base
        // config; individual apps may layer additional tokens on top.
        brand: {
          50:  "#f8fafc",
          100: "#e2e8f0",
          500: "#1e293b",
          600: "#0f172a",
          900: "#020617",
        },
        accent: {
          500: "#f97316",
          600: "#ea580c",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
      },
    },
  },
  plugins: [],
};
