import { test, expect } from './fixtures.js';
import fs from 'fs';
import { boot, shot } from './helpers.js';

const G8 = JSON.parse(fs.readFileSync('engine/game/g8_state.json', 'utf8'));

test('inventory cards keep one size across mixed card art on phone layouts', async ({ page }) => {
  // Chromium stays at the configured 390px viewport; exercise the wider
  // iPhone-sized layout in WebKit as well.
  if (test.info().project.name === 'webkit-iphone') {
    await page.setViewportSize({ width: 430, height: 775 });
  }
  const state = structuredClone(G8);
  const human = state.players.find((p) => p.name === 'Keith');
  human.wizards = [
    'assets/Wizard_Draco_Mortemus.jpg',
    'assets/Wizard_Lacerta_Arborus.jpg',
    'assets/Wizard_Reptilius_Venenum.jpg',
    'assets/Wizard_Ignus_Fulgorus.jpg',
  ];
  human.towers = [
    'assets/Tower_T2_Obsidian_Fortress.jpg',
    'assets/Tower_T3_Emerald_Stronghold.jpg',
    'assets/Tower_T2_Keep_of_Elixers.jpg',
    'assets/Tower_T2_Ivory_Spire.jpg',
    'assets/Tower_T2_Vermillion_Citadel.jpg',
  ];
  await page.addInitScript((s) => localStorage.setItem('lw.save.v1', JSON.stringify(s)), state);
  await boot(page);
  const board = page.getByTestId('board');
  const boardBox = await board.boundingBox();
  await board.tap({ position: { x: boardBox.width * 0.52, y: boardBox.height * 0.486 } });
  const mats = page.getByTestId('mats');
  await expect(mats).toBeVisible();
  await expect.poll(() => mats.locator('.mat.you .mcard').count()).toBeGreaterThan(8);
  await shot(page, `inventory-card-sizing-${page.viewportSize().width}`);

  const cards = mats.locator('.mat.you .mcard');
  const measurements = await cards.evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const img = el.querySelector('img');
    return { width: r.width, height: r.height, fit: img && getComputedStyle(img).objectFit };
  }));
  const widths = measurements.map((m) => m.width);
  const heights = measurements.map((m) => m.height);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.5);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5);
  expect(measurements.filter((m) => m.fit === 'contain').length).toBeGreaterThan(8);
});
