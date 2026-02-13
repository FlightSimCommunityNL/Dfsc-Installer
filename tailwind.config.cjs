/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          900: "rgb(var(--bg-900) / <alpha-value>)",
          800: "rgb(var(--bg-800) / <alpha-value>)",
          700: "rgb(var(--bg-700) / <alpha-value>)",
        },
        panel: "rgb(var(--panel) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        text: {
          100: "rgb(var(--text-100) / <alpha-value>)",
          200: "rgb(var(--text-200) / <alpha-value>)",
          400: "rgb(var(--text-400) / <alpha-value>)",
        },
        accent: "rgb(var(--accent) / <alpha-value>)",
        accent2: "rgb(var(--accent2) / <alpha-value>)",
        highlight: "rgb(var(--highlight) / <alpha-value>)",
      },
    },
  },
  plugins: [],
}
