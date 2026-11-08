import { defineConfig, devices } from '@playwright/test';

const PORT = 4317;
const baseURL = `http://localhost:${String(PORT)}`;

/**
 * End-to-end tests run against the production build with a throwaway in-memory
 * database, so they exercise exactly what `npm run demo` serves.
 *
 * PW_CHANNEL=chrome uses an installed Google Chrome instead of the Chromium that
 * Playwright downloads, for machines Playwright no longer ships a browser for.
 */
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(channel ? { channel } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) } },
    {
      name: 'phone',
      testMatch: /layout\.spec\.ts/,
      use: { ...devices['Pixel 7'], ...(channel ? { channel } : {}) },
    },
  ],
  webServer: {
    command: 'npm run build && npm start',
    url: `${baseURL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      PUBLIC_URL: baseURL,
      DATA_DIR: 'memory',
      SEED_DEMO: 'true',
      LOG_LEVEL: 'warn',
    },
  },
});
