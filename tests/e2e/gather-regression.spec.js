import { test, expect } from './fixtures.js';
import { boot, view, watchErrors } from './helpers.js';
import fs from 'fs';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

test('gather sheet renders, accepts reagents, and confirms on iPhone WebKit', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  const v = await view(page);
  const hand = v.players.find((p) => p.you).hand;
  const legalIdx = hand.findIndex((k) => v.legal?.gather?.[k]);
  expect(legalIdx, 'at least one gatherable hand card').toBeGreaterThanOrEqual(0);

  await page.getByTestId(`hand-${legalIdx}`).tap();
  const sheet = page.getByTestId('gather');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('gather-card')).toBeVisible();
  await expect(sheet.locator('[data-testid^="hot-gather-"]').first()).toBeVisible();
  await expect.poll(async () => sheet.getByTestId('gather-card').boundingBox())
    .toEqual(expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }));

  fs.mkdirSync('docs/screenshots', { recursive: true });
  await sheet.screenshot({ path: 'docs/screenshots/gather-sheet-fixed-dpr3.png' });

  const buttons = sheet.locator('[data-testid^="hot-gather-"]');
  for (let i = 0; i < await buttons.count(); i++) await buttons.nth(i).tap();
  await expect(sheet).toHaveCount(0, { timeout: 20_000 });
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});
