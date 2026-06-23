/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // "trail" — emerald/jade primary. Deliberately distinct from Tsumiki's violet:
        // money is violet, the learning path is green (growth, go, forward).
        trail: {
          50: "#ECFDF5",
          100: "#D1FAE5",
          200: "#A7F3D0",
          300: "#6EE7B7",
          400: "#34D399",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
          800: "#065F46",
          900: "#064E3B",
        },
        // warm amber accent for streaks / momentum (the "fire")
        ember: {
          400: "#FBBF24",
          500: "#F59E0B",
          600: "#D97706",
        },
        // warm sand surface so it doesn't feel like a cold finance dashboard
        sand: {
          50: "#FBFAF7",
          100: "#F5F2EC",
          200: "#EAE5DA",
        },
      },
      fontFamily: {
        // a slightly rounded, friendly stack — distinct feel from Tsumiki
        sans: [
          "ui-rounded",
          '"SF Pro Rounded"',
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
