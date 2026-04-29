import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // A previous catch-all "vendor" chunk created a cycle with react-vendor
        // and broke React initialization (white screen). This explicit split
        // only carves out leaf vendor packages — each chunk depends ONLY on
        // react-vendor (or nothing), never on each other or on the entry.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Only split tightly-scoped vendor packages with clean dep graphs.
          // Avoid splitting libraries that pull in shared utils (clsx,
          // tailwind-merge, lodash) — Rollup may hoist those utils into the
          // vendor chunk and force eager preload of it from the entry.
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (id.includes("/node_modules/@supabase/")) {
            return "supabase-vendor";
          }
          if (id.includes("/node_modules/@radix-ui/")) {
            return "radix-vendor";
          }
          if (id.includes("/node_modules/@tiptap/") || id.includes("/node_modules/prosemirror-")) {
            return "tiptap-vendor";
          }
          return undefined;
        },
      },
    },
  },
}));
