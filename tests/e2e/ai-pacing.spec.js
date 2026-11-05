// AI turns are paced so each move can be read: one banner per AI turn, each move on screen for ~4.4 s (5.0 s for a cast).
// A tap anywhere jumps to the next move; Skip finishes the AI turns. Timing is UI only: skipping ends in the same state.
// g8, after Keith builds: Newt makes 1 move, LizWiz makes 2 (summon, then the dungeon).
import { test, expect } from './fixtures.js';
import { view, shot } from './helpers.js';

async function ready(page) {
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready() && !window.lwDebug.aiRunning(), null, { timeout: 60_000 });
}

// Records every banner change (and its disappearance) with a timestamp, sampled every 25 ms in the page.
async function recordBanners(page) {
  await page.evaluate(() => {
    window.__banners = []; let last = null;
    clearInterval(window.__bannerTimer);
    window.__bannerTimer = setInterval(() => {
      const el = document.querySelector('#banner-layer .banner:not(.out)');
      const cur = el ? `${el.dataset.move}|${el.querySelector('[data-testid=ai-banner-text]')?.textContent}` : null;
      if (cur !== last) {
        window.__banners.push({ t: performance.now(), cur, focus: document.querySelectorAll('.ai-focus').length });
        last = cur;
      }
    }, 25);
  });
}
const banners = (page) => page.evaluate(() => window.__banners);

async function keithBuilds(page) {
  await recordBanners(page);
  await page.getByTestId('slot-tower_face').tap();
  await page.getByTestId('build-reagent').tap();
  await expect(page.getByTestId('ai-banner')).toBeVisible();
}

async function untilKeith(page, timeout) {
  await page.waitForFunction(() => { const v = window.lwDebug.view(); return v.next === 'Keith' && !window.lwDebug.aiRunning(); }, null, { timeout });
  await page.waitForTimeout(150);
}

const outcome = (v) => JSON.stringify({ round: v.round, next: v.next, players: v.players, board: v.board });

test('AI moves are paced and readable; tap = next move; Skip finishes the AI turns with the same result', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  // 1) Hands off: each move stays on screen for its full time, inside one banner per AI turn.
  await keithBuilds(page);
  await expect(page.getByTestId('ai-banner-text')).toContainText('LizWiz summoned', { timeout: 20_000 });
  await shot(page, '15-ai-move-banner');
  await untilKeith(page, 60_000);
  const log = await banners(page);
  const shown = log.filter((x) => x.cur);
  expect(shown.map((x) => x.cur.split('|')[0])).toEqual(['1/1', '1/2', '2/2']);
  expect(shown[0].cur).toContain('Newt gathered');
  expect(shown[1].cur).toContain('LizWiz summoned');
  expect(shown[2].cur).toContain('LizWiz entered the Dungeon');
  const durations = shown.map((x) => log[log.indexOf(x) + 1].t - x.t);
  for (const d of durations) {
    expect(d, `each AI move is on screen ~4.4 s (got ${Math.round(d)} ms)`).toBeGreaterThanOrEqual(4000);
    expect(d).toBeLessThan(7000);
  }
  expect(log[log.indexOf(shown[1]) + 1], 'LizWiz banner stays up between her two moves').toBe(shown[2]);
  expect(shown[1].focus, 'the slot LizWiz summoned from is highlighted during the move').toBe(1);
  test.info().annotations.push({ type: 'ai-move-ms', description: durations.map(Math.round).join(', ') });
  const paced = outcome(await view(page));

  // 2) Same position again: a tap anywhere jumps to the next move, then Skip finishes everything.
  await page.getByTestId('btn-menu').tap();
  await page.getByTestId('menu-restart').tap();
  await expect(page.getByTestId('dock-status')).toContainText('Your move');
  await ready(page);
  await keithBuilds(page);
  await expect(page.getByTestId('ai-banner-text')).toContainText('Newt gathered');
  const t0 = await page.evaluate(() => performance.now());
  await page.getByTestId('turn').tap();                       // the top bar: nothing interactive
  const summoned = () => banners(page).then((b) => b.find((x) => x.cur?.includes('LizWiz summoned')));
  await expect.poll(summoned).toBeTruthy();
  const tNext = (await summoned()).t - t0;
  expect(tNext, `tap advanced to the next move in ${Math.round(tNext)} ms`).toBeLessThan(1500);
  const t1 = Date.now();
  await page.getByTestId('ai-skip').tap();
  await untilKeith(page, 10_000);
  expect(Date.now() - t1, 'Skip finishes the remaining AI moves at once').toBeLessThan(2000);
  await expect(page.locator('#banner-layer .banner')).toHaveCount(0);
  const skipped = (await banners(page)).map((x) => x.cur);
  expect(skipped.some((c) => c?.includes('LizWiz entered the Dungeon')), 'skipped moves are still in the log, not on screen').toBe(false);
  expect(outcome(await view(page)), 'skipping changes timing only: same AI moves, same position').toBe(paced);
  const log2 = await page.evaluate(() => window.lwDebug.log());
  expect(JSON.stringify(log2)).toContain('LizWiz entered the Dungeon');
});
