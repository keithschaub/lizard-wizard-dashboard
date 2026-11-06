import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: Number(process.env.PW_TIMEOUT || 600_000),
  globalTimeout: 2_100_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      // Playwright WebKit with the iPhone 13 descriptor (390x844, iPhone Safari user agent, touch).
      name: 'webkit-iphone',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: process.env.BASE_URL ? undefined : {
    command: 'node tools/serve.mjs 4173',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
