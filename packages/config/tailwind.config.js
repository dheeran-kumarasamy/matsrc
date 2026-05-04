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
        brand: {
          50:  "#eef4fb",
          100: "#cfe0f5",
          500: "#1a4f8a",
          600: "#163f6e",
          900: "#0d2540",
        },
        accent: {
          500: "#e87722",
          600: "#c96318",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
      },
    },
  },
  plugins: [],
};
