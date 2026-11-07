// Hand: legal tap -> gather overlay; non-legal -> expand+swipe with actions above info.
import { test, expect } from './fixtures.js';
import { watchErrors, boot, view } from './helpers.js';

test('legal hand opens gather; non-legal hand expands with swipe group', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  const v = await view(page);
  expect(v.next).toBe('Keith');
  const hand = v.players.find((p) => p.you).hand;
  const legal = v.legal?.gather || {};
  expect(hand.length).toBeGreaterThanOrEqual(2);

  const legalIdx = hand.findIndex((k) => legal[k]);
  expect(legalIdx, 'at least one gatherable card in hand').toBeGreaterThanOrEqual(0);

  await page.getByTestId(`hand-${legalIdx}`).tap();
  await expect(page.getByTestId('gather')).toBeVisible();
  await expect(page.getByTestId('expanded')).toHaveCount(0);
  await expect(page.getByTestId('gather-card')).toBeVisible();
  await expect(page.getByTestId('hot-gather-0')).toBeVisible();
  await page.getByTestId('gather-cancel').tap();

  const badIdx = hand.findIndex((k) => !legal[k]);
  if (badIdx < 0) {
    expect(errors, errors.join('\n')).toEqual([]);
    return;
  }

  await page.getByTestId(`hand-${badIdx}`).tap();
  const ov = page.getByTestId('expanded');
  await expect(ov).toBeVisible();
  await expect(page.getByTestId('card-indicator').locator('.dot')).toHaveCount(hand.length);

  await page.getByTestId('nav-next').tap();
  await page.waitForTimeout(350);

  const body = await ov.evaluate((el) => (el.textContent || '').replace(/\s+/g, ' '));
  expect(body.includes('null'), 'no literal null in expand overlay').toBe(false);

  const actionsBox = await page.getByTestId('expanded-actions').boundingBox();
  const infoBox = await page.getByTestId('cardinfo-container').boundingBox();
  expect(actionsBox && infoBox && actionsBox.y <= infoBox.y, 'actions sit above card info').toBe(true);

  await page.getByTestId('ov-close').tap();
  expect(errors, errors.join('\n')).toEqual([]);
});
