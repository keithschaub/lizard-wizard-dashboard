import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

test('reagent expansion keeps the shared carousel but removes the legacy info panel', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.lwDebug._g;
    const group = Object.keys(g.cards).filter((k) => g.cards[k]?.deck === 'Reagent').slice(0, 3);
    window.ui.expandCard(g, group[0], { group, groupIndex: 0 });
  });

  const overlay = page.getByTestId('expanded');
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId('card-track')).toBeVisible();
  await expect(page.getByTestId('card-indicator')).toBeVisible();
  await expect(page.getByTestId('nav-prev')).toBeVisible();
  await expect(page.getByTestId('nav-next')).toBeVisible();
  await expect(page.getByTestId('card-info')).toHaveCount(0);
  await expect(page.getByTestId('card-track')).toBeInViewport();

  const box = await page.getByTestId('card-track').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(775);
  await page.screenshot({ path: 'docs/screenshots/reagent-expand-430x775.png' });
});
