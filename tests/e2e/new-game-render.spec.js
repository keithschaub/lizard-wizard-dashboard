import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

test('rendering a new player name resets the old game view safely', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const old = window.lwDebug.view();
    const next = structuredClone(old);
    const human = next.players.find((p) => p.you);
    human.name = 'Tester';
    human.tok = ['Eye_of_Newt', 'Horn'];
    next.next = 'Tester';
    next.round = 1;
    try {
      window.lwDebug._g.setView(next);
      return { error: null, round: document.querySelector('[data-testid=round]').textContent };
    } catch (e) {
      return { error: String(e), round: null };
    }
  });

  expect(result.error).toBeNull();
  expect(result.round).toBe('Round 1');
  await expect(page.getByTestId('token-Eye_of_Newt')).toBeVisible();
  await expect(page.getByTestId('token-Horn')).toBeVisible();
});
