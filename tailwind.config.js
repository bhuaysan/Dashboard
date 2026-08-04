export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)", "bg-alt": "var(--color-bg-alt)", "bg-sel": "var(--color-bg-sel)",
        border: "var(--color-border)", "border-strong": "var(--color-border-strong)",
        fg: "var(--color-fg)", dim: "var(--color-dim)",
        accent: "var(--color-accent)", ok: "var(--color-ok)",
        warn: "var(--color-warn)", crit: "var(--color-crit)",
      },
      fontFamily: { mono: ["JetBrains Mono Variable", "ui-monospace", "monospace"] },
    },
  },
};
