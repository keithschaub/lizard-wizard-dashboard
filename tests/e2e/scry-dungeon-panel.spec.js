import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot, watchErrors } from './helpers.js';

// Issue #134. fixtures/issue-134-pre-cast.json: Keith's round 12 save rebuilt to just before he researched and cast
// Scry Dungeon (gold 0; the top 10 Dungeon cards are the ones he saw: Rubies, 2 Gold, Necklace, Great Dragon,
// 1, 1 Gold, Kobold, 2, 1 Gold, Skeleton). Casting it must show what was kept before play moves on.
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-134-pre-cast.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

async function cast(page) {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), SAVE);
  await boot(page);
  await page.evaluate(() => window.ui.researchFlow(window.lwDebug._g, 'Spell_Scry_Dungeon'));
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

  await page.waitForTimeout(1500);                       // no auto-close
  await expect(panel).toBeVisible();
  await panel.locator('.sd-items .sd-card').first().tap();
  await expect(page.getByTestId('expanded')).toBeVisible();
  await page.getByTestId('ov-close').tap();
  await expect(panel).toBeVisible();

  await page.mouse.click(215, 740);                      // outside the panel
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('my-gold')).toHaveText('7');
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
