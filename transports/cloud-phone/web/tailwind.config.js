export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        border: "var(--border)",
        fg: "var(--fg)",
        "fg-muted": "var(--fg-muted)",
        "fg-dim": "var(--fg-dim)",
        neon: {
          green: "var(--neon-green)",
          red: "var(--neon-red)",
          amber: "var(--neon-amber)",
          cyan: "var(--neon-cyan)",
          purple: "var(--neon-purple)",
          pink: "var(--neon-pink)",
          lime: "var(--neon-lime)",
          blue: "var(--neon-blue)",
        },
        accent: "var(--accent)",
      },
    },
  },
  plugins: [],
};
