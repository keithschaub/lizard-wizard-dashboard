import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot, watchErrors } from './helpers.js';

// Issue #134. fixtures/issue-134-pre-cast.json: Keith's round 12 save from just before he researched and cast
// Scry Dungeon (gold 0; the top 10 Dungeon cards are the ones he saw: Rubies, 2 Gold, Necklace, Great Dragon,
// 1, 1 Gold, Kobold, 2, 1 Gold, Skeleton). Casting it must show what was kept before play moves on.
// MOCKUP: boxes measured on the approved after.png (430x775), x, y, w, h.
const MOCKUP = {
  '.sd-panel': [[12.9, 69.8, 404.2, 539.5]],
  '.sd-head': [[25.9, 84.8, 378.2, 73.6]],
  '.sd-spell': [[29.9, 84.8, 40, 60.6]],
  '.sd-gold .sd-card img': [29, 105, 181, 257, 333].map((x) => [x, 172.4, 68, 91.1]),
  '.sd-gold .log-value-chip': [42.2, 118.2, 194.2, 270.2, 346.2].map((x) => [x, 269.5, 41.7, 26]),
  '.sd-effect .log-value-chip': [[123.6, 310, 73, 44], [233.4, 310, 73, 44]],
  '.sd-items .sd-card img': [[103, 383, 104, 138], [223, 383, 104, 138]],
  '[data-testid=sd-continue]': [[25.9, 538.3, 378.2, 54]],
};
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-134-pre-cast.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

async function cast(page) {
  await page.addInitScript((t) => {
    if (sessionStorage.getItem('seeded')) return;           // a reload keeps the game the page saved
    localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1');
  }, SAVE);
  await boot(page);
  await page.evaluate(() => window.ui.researchFlow(window.lwDebug._g, 'Spell_Scry_Dungeon', { groupIndex: -1 }));
  await page.getByTestId('research-cast').tap();
  const panel = page.getByTestId('scry-dungeon-result');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

test('Scry Dungeon shows what was kept, before the next turn (issue #134)', async ({ page }) => {
  const errors = watchErrors(page);
  const panel = await cast(page);
  await expect(panel.locator('.sd-head')).toHaveText('Scry Dungeon');
  await expect(panel.locator('.sd-gold .log-value-chip')).toHaveText(['2', '1', '1', '2', '1']);
  await expect(panel.getByTestId('sd-effect')).toHaveText(/^0\s*→\s*7$/);
  await expect(panel.locator('.sd-items img')).toHaveCount(2);
  expect(await panel.locator('.sd-items img').evaluateAll((els) => els.map((e) => e.alt))).toEqual(['Rubies', 'Necklace']);
  const text = (await panel.innerText()).replace(/\s+/g, ' ');
  expect(text).toBe('Scry Dungeon 2 1 1 2 1 0 → 7 Continue');
  expect(text).not.toMatch(/[+−-]/);
  const box = await panel.getByTestId('sd-panel').boundingBox();
  expect(box.y + box.height, 'the bottom 84px stay clear').toBeLessThanOrEqual(775 - 84);
  await expect(page.locator('#banner-layer .banner')).toHaveCount(0);
  await expect(page.getByTestId('turn')).toHaveText('Your turn');
  await expect(page.getByTestId('my-gold')).toHaveText('0');   // cause before effect: no gold until the coins land

  await page.waitForTimeout(1500);                       // no auto-close
  await expect(panel).toBeVisible();
  await panel.locator('.sd-items .sd-card').first().tap();
  await expect(page.getByTestId('expanded')).toBeVisible();
  await page.getByTestId('ov-close').tap();
  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    window.__goldPulse = false;
    new MutationObserver(() => { if (document.querySelector('[data-testid=my-gold].sd-pulse')) window.__goldPulse = true; })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  await page.mouse.click(215, 740);                      // outside the panel
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('my-gold')).toHaveText('7');
  await expect.poll(() => page.evaluate(() => window.__goldPulse), { timeout: 5_000 }).toBe(true);
  const log = await page.evaluate(() => window.lwDebug.log());
  const i = log.findIndex((e) => e.act === 'research' && e.r === 12 && JSON.stringify(e).includes('Scry_Dungeon'));
  expect(log[i + 1].act).toBe('scry_dungeon');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Scry Dungeon result closes on Continue, then play moves on', async ({ page }) => {
  const panel = await cast(page);
  await panel.getByTestId('sd-continue').tap();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('#banner-layer .banner')).toBeVisible({ timeout: 30_000 });
});

test('Scry Dungeon result matches the approved mockup boxes', async ({ page }) => {
  const panel = await cast(page);
  await page.waitForTimeout(500);
  for (const [sel, want] of Object.entries(MOCKUP)) {
    const got = await panel.locator(sel).evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }));
    expect(got.length, sel).toBe(want.length);
    got.forEach((box, i) => box.forEach((v, j) => expect(Math.abs(v - want[i][j]), `${sel}[${i}] ${['x', 'y', 'w', 'h'][j]} ${v} vs ${want[i][j]}`).toBeLessThanOrEqual(4)));
  }
});

test('Scry Dungeon result survives a reload with the gold still unpaid on the dock', async ({ page }) => {
  const errors = watchErrors(page);
  await cast(page);
  const vp = await page.getByTestId('my-vp').textContent();
  await page.reload();
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  const panel = page.getByTestId('scry-dungeon-result');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId('sd-effect')).toHaveText(/^0\s*→\s*7$/);
  await expect(page.getByTestId('my-gold')).toHaveText('0');
  await expect(page.getByTestId('my-vp')).toHaveText(vp);
  await expect(page.getByTestId('turn')).toHaveText('Your turn');
  await panel.getByTestId('sd-continue').tap();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('my-gold')).toHaveText('7');
  await page.reload();
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  await expect(page.getByTestId('my-gold')).toHaveText('7');
  await expect(page.getByTestId('scry-dungeon-result')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
