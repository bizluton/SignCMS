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
    // Keep production bundling deterministic.
    // The previous custom manualChunks setup created a circular dependency
    // between the React chunk and a shared vendor chunk, which can break
    // React initialization on the published site and cause a white screen.
    chunkSizeWarningLimit: 1200,
  },
}));
