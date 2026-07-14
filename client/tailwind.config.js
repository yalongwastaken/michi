/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Michi's two core colors — an earthy trail pairing that flatters the shiba
        // and drops the old blue/orange clash:
        //   trail (moss 苔色)      = activity & progress — showing up, moving forward
        //   iris  (terracotta 土色) = streaks & achievement — momentum, milestones
        // Sage green and a warm clay sit as a natural, outdoorsy duo (forest floor):
        // green leads as the calm path, clay warms the streaks and badges without the
        // buzz a saturated orange/blue pairing gives off. Names kept (trail/iris) to
        // avoid a 40-file diff — only the values changed.
        // Note the deliberate jump between 600 and 700: 500/600 are the saturated
        // fills, 700+ are the darkened text shades that pass 4.5:1 on white/tints.
        trail: {
          50: "#F2F7F0",
          100: "#E1EEDD",
          200: "#C3DCBB",
          300: "#9CC490",
          400: "#6FA560",
          500: "#4E8640",
          600: "#3E6E33",
          700: "#325A29",
          800: "#294A22",
          900: "#223C1D",
          950: "#10200C",
        },
        // iris = terracotta/clay now; name kept to avoid a 40-file diff. A muted warm
        // brick (not a buzzing safety-orange): airy 100–300 carry dark-mode text,
        // 900/950 tint dark surfaces, 500/600 fill the streak chips and badges.
        iris: {
          50: "#FBF4EF",
          100: "#F6E2D8",
          200: "#EBC3AE",
          300: "#DC9C7F",
          400: "#CB744E",
          500: "#B95530",
          600: "#A2482A",
          700: "#843B23",
          800: "#6A3020",
          900: "#57291D",
          950: "#30150F",
        },
        // slate = the neutral used for text, borders, and every dark-mode surface.
        // Tailwind's default slate carries a blue cast (hue ~215°); this override
        // swaps it for a warm-neutral charcoal (a faint sand-warm hue, very low
        // saturation) so dark mode reads as warm ink — not navy — and the light-mode
        // greys sit better on the cream background. Names kept to avoid a wide diff.
        slate: {
          50: "#F8F7F5",
          100: "#F0EEEB",
          200: "#E3E0DB",
          300: "#CBC7C0",
          400: "#A09C94",
          500: "#74706A",
          600: "#57534D",
          700: "#413E39",
          800: "#2A2724",
          900: "#1C1A17",
          950: "#12100E",
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
