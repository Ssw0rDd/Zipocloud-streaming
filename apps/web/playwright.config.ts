import { defineConfig, devices } from "@playwright/test";

const isNsfwE2E = process.env.E2E_NSFW === "true";
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  (isNsfwE2E ? "http://localhost:3002" : "http://localhost:3000");
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  webServer: [
    {
      command: "pnpm --filter @zipo/api exec bun run src/index.ts",
      url: "http://localhost:3001/health/live",
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: isNsfwE2E
        ? "pnpm --filter @zipo/web dev:nsfw"
        : "pnpm --filter @zipo/web start",
      url: baseURL,
      env: { NODE_ENV: isNsfwE2E ? "development" : "production" },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
