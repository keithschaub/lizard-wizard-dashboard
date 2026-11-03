import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: Number(process.env.PW_TIMEOUT || 600_000),
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4173',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.BASE_URL ? undefined : {
    command: 'node tools/serve.mjs 4173',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
