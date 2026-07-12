/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Terminal color-state inks (docs/01, docs/09). GREEN = live, AMBER = ambient.
        phosphor: {
          green: "#00ff41",
          amber: "#ffb000",
          blue: "#46a4ff",
        },
      },
      fontFamily: {
        terminal: ["VT323", "Share Tech Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
