// Reagent hand: enlarged view swipes across hand; Gather button tracks legal.gather per card.
import { test, expect } from './fixtures.js';
import { watchErrors, boot, view } from './helpers.js';

test('hand gather expand: swipe changes card and Gather action follows legality', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  const v = await view(page);
  expect(v.next).toBe('Keith');
  const hand = v.players.find((p) => p.you).hand;
  const legal = v.legal?.gather || {};
  expect(hand.length).toBeGreaterThanOrEqual(2);

  const startIdx = hand.findIndex((k) => legal[k]);
  expect(startIdx, 'at least one gatherable card in hand').toBeGreaterThanOrEqual(0);

  await page.getByTestId(`hand-${startIdx}`).tap();
  const ov = page.getByTestId('expanded');
  await expect(ov).toBeVisible();
  await expect(page.getByTestId('card-indicator').locator('.dot')).toHaveCount(hand.length);
  await expect(page.getByTestId('hand-gather')).toBeVisible();

  const cardAt = async () => {
    const idx = Number(await ov.locator('[data-testid=card-indicator] .dot.active').getAttribute('data-index'));
    return { idx, key: hand[idx] };
  };

  let cur = await cardAt();
  expect(legal[cur.key]).toBeTruthy();

  await page.getByTestId('nav-next').tap();
  await page.waitForTimeout(350);
  cur = await cardAt();
  if (legal[cur.key]) await expect(page.getByTestId('hand-gather')).toBeVisible();
  else await expect(page.getByTestId('hand-gather')).toHaveCount(0);

  const body = await ov.evaluate((el) => (el.textContent || '').replace(/\s+/g, ' '));
  expect(body.includes('null'), 'no literal null in expand overlay').toBe(false);

  await page.getByTestId('ov-close').tap();
  expect(errors, errors.join('\n')).toEqual([]);
});
