import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// Issue #161: Arch-Mage (Wild) Research & Cast shows 7 reagents + 5 mana; mana was clipped at 430px.
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-161-arch-mage.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

async function chipInsideButton(page, testid, selector) {
  return page.evaluate(({ testid, selector }) => {
    const btn = document.querySelector(`[data-testid="${testid}"]`);
    if (!btn) return { ok: false, reason: 'no button' };
    const chip = btn.querySelector(selector);
    if (!chip) return { ok: false, reason: 'no chip' };
    const br = btn.getBoundingClientRect();
    const cr = chip.getBoundingClientRect();
    const tol = 0.5;
    return {
      ok: cr.left >= br.left - tol && cr.right <= br.right + tol && cr.top >= br.top - tol && cr.bottom <= br.bottom + tol,
      btn: { w: br.width, h: br.height },
      chip: { w: cr.width, h: cr.height, right: cr.right, btnRight: br.right },
    };
  }, { testid, selector });
}

test('Arch-Mage Research & Cast: mana chip stays inside the button at 430px (#161)', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), SAVE);
  await boot(page);
  await page.evaluate(() => {
    const g = window.lwDebug._g;
    const strip = (k) => String(k).replace(/.*\//, '').replace(/\.jpg$/i, '');
    const group = (g.v.board.spell_face || []).filter(Boolean).map(strip);
    const idx = group.indexOf('Spell_Arch_Mage');
    window.ui.researchFlow(g, 'Spell_Arch_Mage', { group, groupIndex: idx });
  });
  const cast = page.getByTestId('research-cast');
  await expect(cast).toBeVisible();
  await expect(cast).toContainText('Research & Cast');
  await expect(cast.locator('.action-chip-reagents .log-reagent-chip')).toHaveCount(7);
  const mana = await chipInsideButton(page, 'research-cast', '.action-chip-row > .log-value-chip');
  expect(mana.ok, JSON.stringify(mana)).toBe(true);
  await expect(cast.locator('.action-chip-row > .log-value-chip .log-value-orb.mana')).toBeVisible();
  await page.locator('[data-testid=expanded]:not(.out)').screenshot({
    path: 'docs/screenshots/issue161-arch-mage-action-chips-430x775.png',
  });
});

test('Build with reagents: max-reagent row keeps chips inside the button (#161)', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), SAVE);
  await boot(page);
  await page.evaluate(() => {
    const g = window.lwDebug._g;
    const tf = g.v.board.tower_face;
    g.v.legal.build = {
      tower: tf,
      reagent: { n: 7, reagent: 'Mandrake' },
      gold: { n: 2 },
    };
    window.ui.buildFlow(g, tf);
  });
  const row = page.getByTestId('build-reagent');
  await expect(row).toBeVisible();
  await expect(row.locator('.action-chip-reagents')).toBeVisible();
  await expect(row.locator('.action-chip-reagents .log-reagent-chip')).toHaveCount(1);
  await expect(row.locator('.action-chip-reagents .log-reagent-count')).toHaveText('×7');
  const chip = await chipInsideButton(page, 'build-reagent', '.action-chip-reagents .log-reagent-chip');
  expect(chip.ok, JSON.stringify(chip)).toBe(true);
  // Build with Gold uses the same chip row pattern with a trailing value chip anchored on the right.
  const goldRow = page.getByTestId('build-gold');
  await expect(goldRow).toBeVisible();
  const trailing = await chipInsideButton(page, 'build-gold', '.sub .log-value-chip');
  expect(trailing.ok, JSON.stringify(trailing)).toBe(true);
});