// The splash must never spin forever: runtime failures are shown with a Retry button that recovers.
import { test, expect } from './fixtures.js';
import fs from 'fs';

const WASM = fs.readFileSync('vendor/pyodide/pyodide.asm.wasm');
// A valid wasm module that imports "zz.f": it validates, but instantiating it with Pyodide's imports fails
// (LinkError) — the path Pyodide 314 swallows with console.warn and never settles loadPyodide.
const UNLINKABLE = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 8, 1, 2, 122, 122, 1, 102, 0, 0]);

test('a truncated runtime download shows a readable error; Retry recovers', async ({ page, context }) => {
  const route = (r) => r.fulfill({ status: 200, contentType: 'application/wasm', body: WASM.subarray(0, 3_000_000) });
  await context.route('**/pyodide.asm.wasm', route);
  await page.goto('/');
  await expect(page.getByTestId('loader-error-text')).toContainText(/Python runtime.*(corrupt|truncated|failed)/, { timeout: 45_000 });
  await expect(page.getByTestId('loader-retry')).toBeVisible();
  await context.unroute('**/pyodide.asm.wasm', route);
  await page.getByTestId('loader-retry').tap();
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await expect(page.getByTestId('loader')).toHaveClass(/done/);
  expect((await page.evaluate(() => window.lwDebug.view())).round).toBe(2);
});

test('a WebAssembly instantiation failure is reported instead of hanging', async ({ page, context }) => {
  await context.route('**/pyodide.asm.wasm', (r) => r.fulfill({ status: 200, contentType: 'application/wasm', body: UNLINKABLE }));
  await page.goto('/');
  await expect(page.getByTestId('loader-error-text')).toContainText(/compiling the Python runtime/, { timeout: 30_000 });
  await expect(page.getByTestId('loader-retry')).toBeVisible();
});

test('a stalled runtime download times out with a message and Retry (never spins forever)', async ({ page, context }) => {
  test.setTimeout(150_000);
  await context.route('**/pyodide.asm.wasm', () => { /* never answer: a dead connection */ });
  await page.goto('/');
  await expect(page.getByTestId('loader-retry')).toBeVisible({ timeout: 75_000 });
  await expect(page.getByTestId('loader')).toContainText(/(no data received for 20 s|Still loading after|No progress for)/);
});
