import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#163536",
        teal: { 50: "#edf9f7", 100: "#d5f1ed", 500: "#168c82", 600: "#0e756d", 700: "#0d5d58" },
        sand: "#f7f8f5"
      },
      boxShadow: { soft: "0 10px 35px rgba(20,53,54,.07)" }
    }
  },
  plugins: []
} satisfies Config;
