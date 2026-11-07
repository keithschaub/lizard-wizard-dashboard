// A finished autosave must never win over a requested new deal.
import { test, expect } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

async function seedFinishedSave(page) {
  await page.addInitScript(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    s.meta = { ...(s.meta || {}), game_over: true };
    localStorage.setItem('lw.save.v1', JSON.stringify(s));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 90_000 });
}

async function finishDeal(page) {
  const picks = page.locator('[data-testid^="pick-"]');
  await picks.nth(0).tap();
  await picks.nth(1).tap();
  await page.getByTestId('new-game-start').tap();
  await expect.poll(() => page.evaluate(() => window.lwDebug.view().round)).toBe(1);
  const view = await page.evaluate(() => window.lwDebug.view());
  expect(view.game_over).toBe(false);
  return view;
}

test('setup, Quick start, and Play again always deal a fresh game', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'iPhone layout project only');

  await seedFinishedSave(page);
  await page.getByTestId('btn-menu').tap();
  await page.getByTestId('menu-new-game').tap();
  await page.getByTestId('setup-name-input').fill('Rex');
  await page.getByTestId('setup-continue').tap();
  await page.getByTestId('setup-size-4').tap();
  await page.getByTestId('setup-continue').tap();
  for (const [i, name] of ['Newt2', 'Gecko2', 'Iggy2'].entries()) {
    await page.getByTestId(`setup-ai-${i}-name`).fill(name);
  }
  await page.getByTestId('setup-start').tap();
  await expect(page.getByTestId('new-game')).toBeVisible();
  const setupView = await finishDeal(page);
  expect(setupView.players.map((p) => p.name)).toEqual(['Rex', 'Newt2', 'Gecko2', 'Iggy2']);

  await page.reload();
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 90_000 });
  await page.getByTestId('btn-menu').tap();
  await page.getByTestId('menu-new-game').tap();
  await page.getByTestId('setup-quick-start').tap();
  await expect(page.getByTestId('new-game')).toBeVisible();
  const quickView = await finishDeal(page);
  expect(quickView.round).toBe(1);
  expect(quickView.players.map((p) => p.name)).toEqual(['Rex', 'Newt2', 'Gecko2', 'Iggy2']);

  await page.evaluate(async () => {
    const dump = await window.lwDebug._g.call('dump');
    const s = JSON.parse(dump.result);
    s.meta = { ...(s.meta || {}), game_over: true };
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    window.lwDebug._g.setView(r.result);
    window.ui.gameOver(window.lwDebug._g);
  });
  await page.getByTestId('go-play-again').tap();
  await expect(page.getByTestId('new-game')).toBeVisible();
  const replayView = await finishDeal(page);
  expect(replayView.round).toBe(1);
  expect(replayView.game_over).toBe(false);
});
