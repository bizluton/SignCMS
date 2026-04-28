import { defineConfig } from "@playwright/test";

/**
 * Sandbox-friendly config: the bundled Playwright headless-shell needs system
 * libs (libglib etc.) that aren't installed here, so we point at a working
 * Chromium provided by nix. Override via env when running elsewhere.
 */
const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  "/nix/store/f0zwc9si9bjhs4vipbbfw0i7my9ck3in-chromium-146.0.7680.80/bin/chromium";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: CHROMIUM_PATH,
      args: ["--no-sandbox"],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
