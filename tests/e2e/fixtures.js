import { test as base, expect } from '@playwright/test';

// GoatCounter's count.js is a third-party script: tests answer it locally so runs never depend on gc.zgo.at.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route('https://gc.zgo.at/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__goatcounterLoaded = true;' }));
    await use(context);
  },
  page: async ({ page }, use) => {
    await use(page);
    // Cleanup: terminate any web workers to prevent hanging
    await page.evaluate(() => {
      if (window.lwDebug?._g?.engine) {
        window.lwDebug._g.engine.terminate();
      }
    }).catch(() => {});
  },
});
export { expect };
