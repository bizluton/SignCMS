import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir:     "src",
      filename:   "sw.ts",
      registerType: "autoUpdate",
      injectManifest: {
        swSrc: "src/sw.ts",
        swDest: "sw.js",
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
        scope:            "/",
        start_url:        "/",
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
