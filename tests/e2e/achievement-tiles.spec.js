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

async function tileGeometry(tile) {
  return tile.evaluate((el) => {
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const t = box(el);
    const icon = box(el.querySelector('.ach-tile-medallion'));
    const count = box(el.querySelector('.ach-tile-count'));
    const label = box(el.querySelector('.ach-tile-label'));
    const inside = (x) => x.left >= t.left && x.right <= t.right && x.top >= t.top && x.bottom <= t.bottom;
    return {
      inside: [icon, count, label].every(inside),
      separated: !intersects(icon, count) && icon.bottom <= label.top - 2,
    };
  });
}

async function reagentGeometry(tile) {
  return tile.locator('.ach-reagent').evaluate((img) => new Promise((resolve) => {
    const med = img.closest('.ach-tile-medallion, .ach-badge');
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] >= 32) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
    }
    const size = 256;
    const scale = Math.min(size * .82 / canvas.width, size * .82 / canvas.height);
    const ox = (size - canvas.width * scale) / 2;
    const oy = (size - canvas.height * scale) / 2;
    const b = { left: ox + left * scale, top: oy + top * scale, right: ox + right * scale, bottom: oy + bottom * scale };
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2, radius = size / 2;
    const insideCircle = b.left >= 0 && b.top >= 0 && b.right <= size && b.bottom <= size;
    resolve({ centerDelta: Math.hypot(cx - radius, cy - radius) / size, insideCircle });
  }));
}

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
    await expect(tile.locator('.ach-tile-icon').locator('img, .ach-tile-orb, .ach-tile-svg')).toHaveCount(1);
    await expect(tile.locator('.ach-tile-count')).not.toBeEmpty();
    await expect(tile.locator('.ach-tile-label')).not.toBeEmpty();
    const geometry = await tileGeometry(tile);
    expect(geometry.inside && geometry.separated, `sample board tile ${i} geometry`).toBe(true);
      if (await tile.locator('.ach-reagent').count()) {
        const reagent = await reagentGeometry(tile);
        expect(reagent.centerDelta <= 0.06 && reagent.insideCircle, `sample reagent ${i} centering`).toBe(true);
      }
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
  await page.getByTestId('ach-2').tap();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/ach-art-v3-zoom-wizards-dpr3.png`, fullPage: true });
  await page.getByTestId('ov-close').tap();

  const iconKeys = [];
  for (let i = 0; i < TILES.length; i += 4) {
    const ach = TILES.slice(i, i + 4);
    await page.evaluate((a) => {
      const s = JSON.parse(localStorage.getItem('lw.save.v1'));
      s.ach = a;
      localStorage.setItem('lw.save.v1', JSON.stringify(s));
    }, ach);
    await page.reload();
    await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 90_000 });
    await page.waitForTimeout(500);
    for (let j = 0; j < ach.length; j++) {
      const tile = page.getByTestId(`ach-${j}`).locator('[data-testid=achievement-tile]');
      await expect(tile.locator('.ach-tile-icon').locator('img, .ach-tile-orb, .ach-tile-svg')).toHaveCount(1);
      await expect(tile.locator('.ach-tile-label')).not.toBeEmpty();
      const geometry = await tileGeometry(tile);
      expect(geometry.inside && geometry.separated, `board tile ${ach[j]} geometry`).toBe(true);
      if (await tile.locator('.ach-reagent').count()) {
        const reagent = await reagentGeometry(tile);
        expect(reagent.centerDelta <= 0.06 && reagent.insideCircle, `reagent ${ach[j]} centering`).toBe(true);
      }
      iconKeys.push(await tile.locator('.ach-tile-medallion > *').evaluate((el) => el.tagName === 'IMG' ? el.getAttribute('src') : el.className));
      await tile.screenshot({ path: `${SHOTS}/ach-contact-${String(i + j).padStart(2, '0')}.png` });
    }
    await page.getByTestId('ach-0').tap();
    await page.waitForTimeout(350);
    for (let j = 0; j < ach.length; j++) {
      const zoomTile = page.locator(`[data-testid=expanded-card][data-index="${j}"] [data-testid=achievement-tile]`);
      await expect(zoomTile).toBeVisible();
      const geometry = await tileGeometry(zoomTile);
      expect(geometry.inside && geometry.separated, `zoom tile ${ach[j]} geometry`).toBe(true);
      if (await zoomTile.locator('.ach-reagent').count()) {
        const reagent = await reagentGeometry(zoomTile);
        expect(reagent.centerDelta <= 0.06 && reagent.insideCircle, `zoom reagent ${ach[j]} centering`).toBe(true);
      }
      const badge = page.getByTestId('cardinfo-container').locator('.ach-reagent');
      if (await badge.count()) {
        const reagent = await reagentGeometry(page.getByTestId('cardinfo-container'));
        expect(reagent.centerDelta <= 0.06 && reagent.insideCircle, `badge reagent ${ach[j]} centering`).toBe(true);
      }
      if (ach[j] === '100 Mana') await page.screenshot({ path: `${SHOTS}/ach-art-v3-zoom-mana-dpr3.png`, fullPage: true });
      if (ach[j] === '7 Spells') await page.screenshot({ path: `${SHOTS}/ach-art-v3-zoom-spells-dpr3.png`, fullPage: true });
      if (ach[j] === 'x7 Foxglove') await page.screenshot({ path: `${SHOTS}/ach-art-v3-zoom-foxglove-dpr3.png`, fullPage: true });
      if (ach[j] === 'x7 Mandrake') await page.screenshot({ path: `${SHOTS}/ach-art-v3-zoom-mandrake-dpr3.png`, fullPage: true });
      if (ach[j] === 'x7 Sulphur') await page.screenshot({ path: `${SHOTS}/ach-art-v3-zoom-sulphur-dpr3.png`, fullPage: true });
      if (j < ach.length - 1) {
        await page.getByTestId('nav-next').tap();
        await page.waitForTimeout(250);
      }
    }
    await page.getByTestId('ov-close').tap();
  }
  expect(new Set(iconKeys).size, 'every achievement has a distinct icon source').toBe(TILES.length);
});
