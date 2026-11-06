// Achievement expand: no "null" text in overlay; large tile visible; swipe group when several tiles.
import { test, expect } from './fixtures.js';
import { watchErrors, boot, view } from './helpers.js';

test('achievement zoom: visible tile, no null text, swipe between tiles', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 664 });
  await boot(page);
  const v = await view(page);
  expect(v.board.ach?.length).toBeGreaterThanOrEqual(2);

  await page.getByTestId('ach-0').tap();
  const ov = page.getByTestId('expanded');
  await expect(ov).toBeVisible();
  // Swipe pre-renders neighbor frames, so more than one tile exists; pair with the active dot's data-index.
  const activeTile = async () => {
    const idx = await ov.locator('[data-testid=card-indicator] .dot.active').getAttribute('data-index');
    return ov.locator(`[data-testid=expanded-card][data-index="${idx}"] [data-testid=achievement-tile]`);
  };
  await expect(await activeTile()).toBeVisible();
  const tx = await ov.evaluate((el) => (el.textContent || '').replace(/\s+/g, ' '));
  expect(tx.includes('null'), 'no literal null in overlay').toBe(false);

  await expect(page.getByTestId('card-indicator')).toBeVisible();
  await expect(page.getByTestId('card-indicator').locator('.dot')).toHaveCount(v.board.ach.length);

  const t0 = await (await activeTile()).textContent();
  const next = page.getByTestId('nav-next');
  if (await next.isVisible()) {
    await next.tap();
    await page.waitForTimeout(300);
    const t1 = await (await activeTile()).textContent();
    expect(t1).not.toBe(t0);
  }

  await page.getByTestId('ov-close').tap();
  await expect(page.getByTestId('expanded')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
