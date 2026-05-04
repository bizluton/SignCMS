import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// When deployed to GitHub Pages the app lives at /SignCMS/.
// Locally and on any custom domain it lives at the root.
const base = process.env.GITHUB_PAGES === "1" ? "/SignCMS/" : "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir:     "src",
      filename:   "sw.ts",
      registerType: "autoUpdate",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      manifest: {
        name:             "SignCMS Go",
        short_name:       "SignCMS Go",
        description:      "Conversational digital signage management via MCP",
        theme_color:      "#0f172a",
        background_color: "#0f172a",
        display:          "standalone",
        orientation:      "portrait",
        scope:            base,
        start_url:        base,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      devOptions: {
        enabled: true,
        type:    "module",
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
