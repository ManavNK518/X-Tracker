import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against a production build in demo mode with network
 * sources disabled, using a throwaway embedded database. No paid APIs are
 * called. On Windows the installed Microsoft Edge is used by default
 * (override with PW_CHANNEL, or run `npx playwright install chromium` and set
 * PW_CHANNEL=chromium).
 */
const PORT = Number(process.env.E2E_PORT ?? 3211);
const channel = process.env.PW_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(channel && channel !== "chromium" ? { channel } : {}),
  },
  webServer: {
    // The web server starts before any global setup, so the throwaway database is
    // reset here, before the server opens it.
    command: `node tests/e2e/reset-db.mjs && node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      DEMO_MODE: "true",
      DEMO_INTERVAL_SECONDS: "0",
      RSS_ENABLED: "false",
      PGLITE_DATA_DIR: ".data/e2e",
      WORKER_MODE: "inline",
      ALLOW_SIGNUP: "false",
      APP_URL: `http://localhost:${PORT}`,
      NEXT_TELEMETRY_DISABLED: "1",
      X_BEARER_TOKEN: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
