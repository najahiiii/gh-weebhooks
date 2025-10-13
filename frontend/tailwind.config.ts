import type { Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(214, 32%, 17%)",
        input: "hsl(214, 32%, 17%)",
        ring: "hsl(214, 100%, 50%)",
        background: "hsl(222, 47%, 11%)",
        foreground: "hsl(210, 40%, 98%)",
        primary: {
          DEFAULT: "hsl(217, 91%, 60%)",
          foreground: "hsl(210, 40%, 98%)"
        },
        secondary: {
          DEFAULT: "hsl(215, 25%, 25%)",
          foreground: "hsl(210, 40%, 98%)"
        }
      },
      fontFamily: {
        sans: ["Inter", ...fontFamily.sans]
      }
    }
  }
};

export default config;
