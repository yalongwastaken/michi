/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Michi's two core colors are balanced and complementary:
        //   trail (emerald green) = activity & progress — showing up, moving forward
        //   iris  (violet)        = streaks & achievement — momentum, milestones
        // Green ~150° and violet ~265° on the wheel sit a harmonious ~115° apart, so
        // they energize each other without clashing. (Iris is its own purple, clear
        // of Tsumiki's blue-violet periwinkle.)
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
        iris: {
          50: "#F5F3FF",
          100: "#EDE9FE",
          200: "#DDD6FE",
          300: "#C4B5FD",
          400: "#A78BFA",
          500: "#8B5CF6",
          600: "#7C3AED",
          700: "#6D28D9",
          800: "#5B21B6",
          900: "#4C1D95",
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
