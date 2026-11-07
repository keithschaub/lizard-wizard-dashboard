// Unified achievement tiles: icon on every type, no duplicated "(School)" in titles.
import { test, expect } from './fixtures.js';
import fs from 'fs';
import { shot } from './helpers.js';

const ACH_FILE = 'engine/cards/cards.json';
const G8_ENGINE = JSON.parse(fs.readFileSync('engine/game/g8_state.json', 'utf8'));
const TILES = JSON.parse(fs.readFileSync(ACH_FILE, 'utf8')).achievements.tiles.map((t) => t.text);
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function seedAch(page, ach) {
  const s = structuredClone(G8_ENGINE);
  s.ach = ach;
  await page.addInitScript((t) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('lw.save.v1', t);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(s));
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 90_000 });
}

const SHOTS = 'docs/screenshots';

test('achievement tiles: icon + stacked layout, info titles without parenthetical duplicate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sample = ['5 Necromancy cards', '10 Gold', '5 Wizards', '5 Druidry cards'];
  await seedAch(page, sample);
  await page.waitForTimeout(400);
  const achBoxes = await page.locator('.ach').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }));
  const column = {
    x: Math.max(0, Math.min(...achBoxes.map((b) => b.left)) - 4),
    y: Math.max(0, Math.min(...achBoxes.map((b) => b.top)) - 4),
    width: Math.min(390, Math.max(...achBoxes.map((b) => b.right)) - Math.min(...achBoxes.map((b) => b.left)) + 8),
    height: Math.max(...achBoxes.map((b) => b.bottom)) - Math.min(...achBoxes.map((b) => b.top)) + 8,
  };
  await page.screenshot({ path: `${SHOTS}/ach-art-v3-board-column-dpr3.png`, clip: column });
  await page.screenshot({ path: `${SHOTS}/ach-art-v3-full-board-dpr3.png`, fullPage: true });
  for (let i = 0; i < sample.length; i++) {
    const tile = page.getByTestId(`ach-${i}`).locator('[data-testid=achievement-tile]');
    await expect(tile).toBeVisible();
    await expect(tile.locator('.ach-tile-icon').locator('img, .ach-tile-orb')).toHaveCount(1);
    await expect(tile.locator('.ach-tile-count')).not.toBeEmpty();
    await expect(tile.locator('.ach-tile-label')).not.toBeEmpty();
  }
  await page.getByTestId('ach-1').tap();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/ach-art-v3-zoom-gold-dpr3.png`, fullPage: true });
  const panel = () => page.getByTestId('expanded').getByTestId('cardinfo-container');
  await expect(panel().locator('.ci-name', { hasText: '10 Gold' })).toBeVisible();
  await expect(panel().locator('[data-testid=achievement-badge]').first().locator('img, .ach-tile-orb')).toHaveCount(1);
  await page.getByTestId('ov-close').tap();

  await page.getByTestId('ach-0').tap();
  await page.waitForTimeout(450);
  await expect(panel().locator('.ci-name', { hasText: '5 Necromancy Cards' })).toBeVisible();
  const title = await panel().locator('.ci-name', { hasText: '5 Necromancy Cards' }).textContent();
  expect(title).not.toMatch(/\([^)]+\)/);
  await page.screenshot({ path: `${SHOTS}/ach-art-v3-zoom-necromancy-dpr3.png`, fullPage: true });
  await page.getByTestId('ov-close').tap();

  for (let i = 0; i < TILES.length; i += 4) {
    const ach = TILES.slice(i, i + 4);
    await page.evaluate((a) => {
      const s = JSON.parse(localStorage.getItem('lw.save.v1'));
      s.ach = a;
      localStorage.setItem('lw.save.v1', JSON.stringify(s));
    }, ach);
    await page.reload();
    await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 90_000 });
    for (let j = 0; j < ach.length; j++) {
      const tile = page.getByTestId(`ach-${j}`).locator('[data-testid=achievement-tile]');
      await expect(tile.locator('.ach-tile-icon').locator('img, .ach-tile-orb')).toHaveCount(1);
    }
  }
});
