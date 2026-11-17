import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// End-to-end tests run against the production build (with the real CSP), served by the real Express server.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts', // keeps Vitest from picking these files up
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1400, height: 900 },
    // The tests assert Arabic UI text, and the app follows the device language on first visit,
    // so pin the browser locale to Arabic instead of relying on the runner's default (en-US).
    locale: 'ar-EG',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: 'npm run build && npx tsx server.ts',
    env: { PORT: String(PORT), NODE_ENV: 'production' },
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
