import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// Issue #128. fixtures/issue-123-new-research.json: Keith's round 23 save after summoning Aranea for New Research.
// The familiar's New Research shows all four new spells at once (2x2), the first selected; tapping a card selects
// it and the one Research button takes the selected spell.
const NEW_RESEARCH = fs.readFileSync('tests/e2e/fixtures/issue-123-new-research.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

test('familiar New Research shows four spells at once and takes the selected one (issue #128)', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), NEW_RESEARCH);
  await boot(page);
  const nr = page.getByTestId('new-research');
  const cards = nr.locator('.nr-card');
  await expect(cards).toHaveCount(4);
  const four = await page.evaluate(() => window.lwDebug.view().pending.four);

  const boxes = await cards.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, src: e.querySelector('img').getAttribute('src') }; }));
  expect(new Set(boxes.map((b) => b.src)).size, 'four distinct spells').toBe(4);
  for (const [i, b] of boxes.entries()) {
    expect(b.src).toContain(four[i]);
    expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= 430 && b.y + b.h <= 775, `card ${i + 1} fully on screen`).toBe(true);
  }
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const a = boxes[i], b = boxes[j];
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `cards ${i + 1} and ${j + 1} do not overlap`).toBe(true);
  }
  await expect(page.locator('[data-testid=card-indicator], [data-testid=nav-next], [data-testid=nav-prev]')).toHaveCount(0);
  const button = await nr.getByTestId('nr-take').boundingBox();
  expect(button.y + button.height, 'Research sits above the bottom bar reserve').toBeLessThanOrEqual(775 - 84);

  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await cards.nth(2).tap();
  for (let i = 0; i < 4; i++) await expect(cards.nth(i)).toHaveAttribute('aria-pressed', String(i === 2));
  await nr.getByTestId('nr-take').tap();
  await expect(nr).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.lwDebug.view().pending)).toBeNull();
  const mine = await page.evaluate(() => JSON.stringify(window.lwDebug.view().players.find((p) => p.you).spells));
  expect(mine).toContain(four[2]);
  for (const k of [four[0], four[1], four[3]]) expect(mine).not.toContain(k);
});
