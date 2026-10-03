/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep ink — near-black with a green cast.
        ink: {
          950: "#090b06",
          900: "#0f120a",
          850: "#141810",
          800: "#1a1f14",
          700: "#262c1e",
          600: "#39412b",
          50: "#f2f5ea",
        },
        // Volt lime — Curvelo's signature accent.
        volt: {
          300: "#d9fa70",
          400: "#c8f542",
          500: "#a8d92e",
          600: "#84b31f",
        },
        // Supporting accents, tuned for dark backgrounds. Volt stays the
        // brand primary; these add variety to stats and statuses.
        sky: {
          300: "#a8d8ff",
          400: "#7cc4ff",
        },
        ember: {
          300: "#ffc79c",
          400: "#ffa25e",
        },
        mint: {
          300: "#a7f0cd",
          400: "#6fe3ae",
        },
        rose: {
          300: "#ffb3c0",
          400: "#fb7f95",
        },
        mist: "#a7ae97",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        glow: "0 0 28px rgba(200, 245, 66, 0.28)",
        card: "0 8px 32px rgba(0, 0, 0, 0.35)",
      },
    },
  },
  plugins: [],
};
