import { expect } from '@playwright/test';
import fs from 'fs';

export const SHOTS = 'docs/screenshots';

export function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
  return errors;
}

export async function boot(page) {
  const t0 = Date.now();
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  return Date.now() - t0;
}

export const view = (page) => page.evaluate(() => window.lwDebug.view());
export const cards = (page) => page.evaluate(() => window.lwDebug.cards());
export const me = (v) => v.players.find((p) => p.you);

export async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

export async function openOverlays(page) {
  return page.evaluate(() => [...document.querySelectorAll('#overlays .overlay:not(.out)')].map((o) => o.dataset.testid));
}

export async function tapEmptyBoard(page) {
  const b = await page.getByTestId('board').boundingBox();
  const s = b.width / 864;
  await page.touchscreen.tap(b.x + 450 * s, b.y + 560 * s);   // the castle, between the card rows
}

// Wait until it is Keith's own action (AI turns animated, overlays closed). Auctions started by an AI open the arena:
// onArena() answers them with taps.
export async function untilMyAction(page, onArena) {
  for (let i = 0; i < 1200; i++) {
    const s = await page.evaluate(() => ({
      v: window.lwDebug.view(), ai: window.lwDebug.aiRunning(),
      ov: [...document.querySelectorAll('#overlays .overlay:not(.out)')].map((o) => o.dataset.testid),
    }));
    if (s.v.game_over) return s.v;
    if (s.ov.includes('arena')) {
      if (await page.getByTestId('bid-pass').isEnabled({ timeout: 500 }).catch(() => false)) await onArena();
      else await page.waitForTimeout(200);
      continue;
    }
    if (!s.ai && s.ov.length === 0 && s.v.next === 'Keith' && !s.v.auction && !s.v.pending && s.v.legal) return s.v;
    await page.waitForTimeout(200);
  }
  throw new Error('it never became Keith\'s action again');
}

export async function waitOverlayGone(page, testid) {
  await expect(page.getByTestId(testid)).toHaveCount(0, { timeout: 30_000 });
}

// Put back `n` tokens by tapping them, preferring reagents not in `keep`.
export async function tapPutbacks(page, keep = []) {
  const pool = page.getByTestId('putback-pool').locator('button');
  const counter = await page.getByTestId('putback-count').textContent();
  const n = Number(counter.split('/')[1]);
  const reagents = await pool.evaluateAll((bs) => bs.map((b) => b.dataset.reagent));
  const have = {}; const need = {};
  reagents.forEach((r) => { have[r] = (have[r] || 0) + 1; });
  keep.forEach((r) => { need[r] = (need[r] || 0) + 1; });
  const picks = [];
  reagents.forEach((r, i) => { if (picks.length < n && have[r] - 1 >= (need[r] || 0)) { picks.push(i); have[r] -= 1; } });
  reagents.forEach((r, i) => { if (picks.length < n && !picks.includes(i)) picks.push(i); });
  for (const i of picks) await page.getByTestId(`putback-${i}`).tap();
  return picks.map((i) => reagents[i]);
}

// After the keep taps: the gather sheet shows the cast choice, the put-back choice, or closes (committed).
export async function gatherPhase(page) {
  for (let i = 0; i < 100; i++) {
    if (await page.getByTestId('skip-cast').isVisible().catch(() => false)) return 'cast';
    if (await page.getByTestId('putback-pool').isVisible().catch(() => false)) return 'putback';
    if ((await page.getByTestId('gather').count()) === 0 && (await page.getByTestId('summon-gather-flow').count()) === 0) return 'done';
    await page.waitForTimeout(150);
  }
  throw new Error('gather sheet stuck');
}
