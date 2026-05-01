import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0", opacity: "0" },
          to: { height: "var(--radix-accordion-content-height)", opacity: "1" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)", opacity: "1" },
          to: { height: "0", opacity: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-out": {
          "0%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(10px)" },
        },
        "scale-in": {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "slide-in-right": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "count-up": {
          "0%": { opacity: "0", transform: "scale(0.5)" },
          "60%": { opacity: "1", transform: "scale(1.05)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "studio-active-pulse": {
          "0%, 100%": {
            boxShadow:
              "0 0 0 2px hsl(var(--background)), 0 0 0 3px hsl(var(--primary)), 0 0 12px 1px hsl(var(--primary) / 0.35)",
          },
          "50%": {
            boxShadow:
              "0 0 0 2px hsl(var(--background)), 0 0 0 3px hsl(var(--primary)), 0 0 18px 3px hsl(var(--primary) / 0.5)",
          },
        },
        "studio-tab-pop": {
          "0%": { transform: "translateY(1px) scale(0.985)", opacity: "0.4" },
          "100%": { transform: "translateY(0) scale(1)", opacity: "1" },
        },
        "studio-indicator-grow": {
          "0%": { transform: "scaleX(0)", opacity: "0" },
          "100%": { transform: "scaleX(1)", opacity: "1" },
        },
        "studio-rail-sheen": {
          "0%": { backgroundPosition: "0% 0%" },
          "100%": { backgroundPosition: "0% 200%" },
        },
        "studio-rail-arrow": {
          "0%, 100%": { transform: "translateX(0)", opacity: "0.6" },
          "50%": { transform: "translateX(2px)", opacity: "1" },
        },
        "studio-panel-expand": {
          "0%": { opacity: "0", transform: "translateX(-6px) scale(0.985)" },
          "100%": { opacity: "1", transform: "translateX(0) scale(1)" },
        },
        "studio-toolbar-expand": {
          "0%": { opacity: "0", transform: "translateY(-4px) scale(0.96)", filter: "blur(2px)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)", filter: "blur(0)" },
        },
        "field-error-flash": {
          "0%, 100%": { borderColor: "hsl(var(--input))", boxShadow: "none" },
          "30%, 70%": { borderColor: "hsl(var(--destructive))", boxShadow: "0 0 0 2px hsl(var(--destructive) / 0.35)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.4s ease-out forwards",
        "fade-out": "fade-out 0.3s ease-out forwards",
        "scale-in": "scale-in 0.3s ease-out forwards",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "slide-up": "slide-up 0.5s ease-out forwards",
        "count-up": "count-up 0.6s ease-out forwards",
        "enter": "fade-in 0.4s ease-out forwards, scale-in 0.3s ease-out forwards",
        "shimmer": "shimmer 2s linear infinite",
        "studio-active-pulse": "studio-active-pulse 3.6s ease-in-out infinite",
        "studio-tab-pop": "studio-tab-pop 0.18s ease-out",
        "studio-indicator-grow": "studio-indicator-grow 0.22s ease-out forwards",
        "studio-rail-sheen": "studio-rail-sheen 6s ease-in-out infinite",
        "studio-rail-arrow": "studio-rail-arrow 1.6s ease-in-out infinite",
        "studio-panel-expand": "studio-panel-expand 0.32s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "studio-toolbar-expand": "studio-toolbar-expand 0.24s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "field-error-flash": "field-error-flash 0.5s ease-in-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
