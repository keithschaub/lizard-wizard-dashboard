import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// Issue #161: Arch-Mage (Wild) Research & Cast shows 7 reagents + 5 mana; mana was clipped at 430px.
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-161-arch-mage.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

function enabledArchMageSave() {
  const s = JSON.parse(SAVE);
  const me = s.players.find((p) => p.name === '13InchesOfFun');
  me.mana = 30;
  me.tok = ['Eye_of_Newt', 'Foxglove', 'Horn', 'Mandrake', 'Nightshade', 'Sulphur', 'Toadstool'];
  return JSON.stringify(s);
}

async function openArchMageResearch(page, saveText) {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), saveText);
  await boot(page);
  await page.evaluate(() => {
    const g = window.lwDebug._g;
    const strip = (k) => String(k).replace(/.*\//, '').replace(/\.jpg$/i, '');
    const group = (g.v.board.spell_face || []).filter(Boolean).map(strip);
    const idx = group.indexOf('Spell_Arch_Mage');
  if (g.v.legal?.research?.Spell_Arch_Mage) g.v.legal.research.Spell_Arch_Mage.castable = true;
    window.ui.researchFlow(g, 'Spell_Arch_Mage', { group, groupIndex: idx });
  });
}

async function layoutOfActionRow(page, testid) {
  return page.evaluate((testid) => {
    const btn = document.querySelector(`[data-testid="${testid}"]`);
    if (!btn) return { ok: false, reason: 'no button' };
    const label = btn.children[0];
    const lr = label.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const chips = [...btn.querySelectorAll('.log-reagent-chip, .log-value-chip')];
    const rects = chips.map((c) => c.getBoundingClientRect());
    const tol = 0.5;
    const inside = (cr) => cr.left >= br.left - tol && cr.right <= br.right + tol
      && cr.top >= br.top - tol && cr.bottom <= br.bottom + tol;
    const overlap = rects.some((cr) => cr.right > lr.left && cr.left < lr.right && cr.bottom > lr.top && cr.top < lr.bottom);
    const first = rects[0];
    const gap = first ? first.left - lr.right : 0;
    const clear = !overlap && (gap >= 1 || lr.right <= first.left);
    return {
      ok: clear && rects.every(inside),
      overlap,
      gap,
      label: { w: lr.width, h: lr.height, right: lr.right },
      chips: rects.map((c) => ({ w: c.width, h: c.height })),
      btn: { w: br.width, h: br.height },
      disabled: btn.disabled,
    };
  }, testid);
}

test('Arch-Mage Research & Cast: label, chips, and mana fit without overlap at 430px (#161)', async ({ page }) => {
  await openArchMageResearch(page, enabledArchMageSave());
  const cast = page.getByTestId('research-cast');
  await expect(cast).toBeVisible();
  await expect(cast).toBeEnabled();
  await expect(cast).toContainText('Research & Cast');
  await expect(cast.locator('.action-chip-reagents .log-reagent-chip')).toHaveCount(7);
  const layout = await layoutOfActionRow(page, 'research-cast');
  expect(layout.ok, JSON.stringify(layout)).toBe(true);
  expect(layout.chips.slice(0, 7).every((c) => c.w >= 20 && c.w <= 44 && c.h >= 30 && c.h <= 34), JSON.stringify(layout.chips)).toBe(true);
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
  const layout = await layoutOfActionRow(page, 'build-reagent');
  expect(layout.ok, JSON.stringify(layout)).toBe(true);
  const goldRow = page.getByTestId('build-gold');
  await expect(goldRow).toBeVisible();
  const goldLayout = await layoutOfActionRow(page, 'build-gold');
  expect(goldLayout.ok, JSON.stringify(goldLayout)).toBe(true);
});