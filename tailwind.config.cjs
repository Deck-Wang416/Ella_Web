/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d8e9ff",
          200: "#b2d4ff",
          300: "#84b9ff",
          400: "#4f98ff",
          500: "#2b7bff",
          600: "#1a5fd4",
          700: "#194ea8",
          800: "#1b4488",
          900: "#1b3b70"
        },
        ink: {
          900: "#0f172a",
          700: "#334155",
          500: "#64748b",
          300: "#cbd5e1",
          200: "#e2e8f0",
          100: "#f1f5f9"
        }
      },
      fontFamily: {
        display: ["Fraunces", "serif"],
        body: ["Nunito Sans", "system-ui", "sans-serif"]
      },
      boxShadow: {
        card: "0 12px 30px rgba(15, 23, 42, 0.08)"
      }
    }
  },
  plugins: []
};
