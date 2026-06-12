import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d12",
        panel: "#141821",
        panel2: "#1b2030",
        border: "#262c3a",
        accent: "#5b8cff",
        good: "#3ecf8e",
        warn: "#f5a623",
        bad: "#ff5c5c",
        muted: "#8a93a6",
      },
    },
  },
  plugins: [],
} satisfies Config;
