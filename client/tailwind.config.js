/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Michi's two core colors, a Japanese-classic pairing that flatters the shiba:
        //   trail (persimmon 柿色)  = activity & progress — showing up, moving forward
        //   iris  (indigo 藍色)     = streaks & achievement — momentum, milestones
        // Warm orange and a slightly muted indigo sit near-complementary, so they
        // energize each other without buzzing the way pure orange/blue would.
        // trail = persimmon now; name kept to avoid a 40-file diff.
        // Note the deliberate jump between 600 and 700: 500/600 are the saturated
        // fills, 700+ are the darkened text shades that pass 4.5:1 on white/tints.
        trail: {
          50: "#FEF4EC",
          100: "#FDE4D0",
          200: "#FAC7A1",
          300: "#F6A26B",
          400: "#F47C36",
          500: "#F25C05",
          600: "#E04E00",
          700: "#A83B00",
          800: "#7F2D03",
          900: "#662604",
          950: "#3D1502",
        },
        // iris = indigo now; name kept to avoid a 40-file diff. A warm, muted indigo
        // (not electric blue-violet): airy 100–300 carry dark-mode text, 900/950 tint
        // dark surfaces.
        iris: {
          50: "#F3F4FB",
          100: "#E7E9F7",
          200: "#CCD1EC",
          300: "#A9B1DC",
          400: "#808CC9",
          500: "#5B67B7",
          600: "#4F5D9E",
          700: "#414D83",
          800: "#353F6A",
          900: "#2C3456",
          950: "#1A1F36",
        },
        // warm sand surface so it doesn't feel like a cold finance dashboard
        sand: {
          50: "#FBFAF7",
          100: "#F5F2EC",
          200: "#EAE5DA",
          300: "#DCD4C3", // the winding path's unwalked trail stroke
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
