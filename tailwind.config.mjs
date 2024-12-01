import defaultTheme from "tailwindcss/defaultTheme";
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist Sans", ...defaultTheme.fontFamily.sans],
        mono: ["Geist Mono", ...defaultTheme.fontFamily.mono],
        bungee: ["Bungee Shade", ...defaultTheme.fontFamily.sans],
      },
      colors: {
        customNeutral: {
          100: "#FCFCFA",
          200: "#FAF9F7",
          300: "#F5F4F0",
          400: "#EDEBE4",
          500: "#E5E1D7",
          600: "#CFC5B0",
          700: "#AB9878",
          800: "#AB9878",
          900: "#66492B",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
