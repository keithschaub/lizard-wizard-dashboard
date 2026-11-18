import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';
import { REAGENT_ICON_POS } from '../../app/js/reagent-icon-positions.js';

// Issue #140: the Gather keep overlay's tap rings must sit on each reagent icon's art, on every Reagent card and both
// halves. Icon centres come from tools/measure_reagent_icons.py (template matching on the card art). Keith's round 3
// save (fixtures/issue-140.json) is reused with his hand set to one card at a time; Miracle is cast so the Increase
// Value half has rings too.
const SAVE = JSON.parse(fs.readFileSync('tests/e2e/fixtures/issue-140.json', 'utf8'));
const CARDS = Object.keys(REAGENT_ICON_POS).sort();
const TOLERANCE_PX = 2;

test.use({ viewport: { width: 430, height: 775 } });
test.setTimeout(240_000);

function stateWith(card, spells) {
  const s = structuredClone(SAVE);
  const me = s.players.find((p) => p.name === '13InchesOfFun');
  const asset = `/workspace/lizard-wizard/assets/${card}.jpg`;
  for (const p of s.players) p.hand = p.hand.filter((x) => !x.endsWith(`/${card}.jpg`));
  s.reag_list = s.reag_list.filter((x) => !x.endsWith(`/${card}.jpg`));
  s.reag_discard = s.reag_discard.filter((x) => !x.endsWith(`/${card}.jpg`));
  me.hand = [asset, ...me.hand.slice(0, 2)];
  me.spells = [...(me.spells || []), ...spells.map((k) => ({ img: `/workspace/lizard-wizard/assets/${k}.jpg`, cast: true }))];
  return JSON.stringify(s);
}

// Ring centres as fractions of the card image, for the halves that have rings.
async function rings(page, card, text) {
  return page.evaluate(async ({ card, text }) => {
    const g = window.lwDebug._g;
    const r = await g.call('load', { text });
    if (!r.ok) throw new Error(r.error);
    g.setView(r.result, { fresh: true });
    window.ui.closeAll();
    const ov = await window.ui.gatherFlow(g, card);
    const img = ov.el.querySelector('img.gcard');
    if (!img.complete) await new Promise((res) => { img.onload = res; });
    await new Promise((res) => setTimeout(res, 350));   // the card zooms in over 280 ms; measure at full size
    const box = img.getBoundingClientRect();
    const out = {};
    for (const b of ov.el.querySelectorAll('.hot')) {
      const [, half, i] = b.dataset.testid.split('-');
      const c = b.getBoundingClientRect();
      (out[half] ||= [])[Number(i)] = { x: (c.left + c.width / 2 - box.left) / box.width, y: (c.top + c.height / 2 - box.top) / box.height, w: box.width, h: box.height };
    }
    ov.close();
    return out;
  }, { card, text });
}

function expectCentred(card, got, halves) {
  for (const half of halves) {
    const want = REAGENT_ICON_POS[card][half];
    expect(got[half]?.length, `${card} ${half}: one ring per icon`).toBe(want.length);
    got[half].forEach((c, i) => {
      const dx = (c.x - want[i][0]) * c.w; const dy = (c.y - want[i][1]) * c.h;
      expect(Math.hypot(dx, dy), `${card} ${half} ring ${i} is ${dx.toFixed(1)}, ${dy.toFixed(1)} px off its icon`).toBeLessThanOrEqual(TOLERANCE_PX);
    });
  }
}

test('every ring sits on its icon, on every Reagent card, both halves (Miracle)', async ({ page }) => {
  await boot(page);
  expect(CARDS).toHaveLength(56);
  for (const card of CARDS) expectCentred(card, await rings(page, card, stateWith(card, ['Spell_Miracle'])), ['gather', 'increase']);
});

test('with Maximum Gather the rings stay on the icons', async ({ page }) => {
  await boot(page);
  const many = CARDS.filter((k) => REAGENT_ICON_POS[k].gather.length > 3);
  expect(many.length).toBeGreaterThan(30);
  for (const card of many) expectCentred(card, await rings(page, card, stateWith(card, ['Spell_Maximum_Gather'])), ['gather']);
});

test('issue #140 card from Keith\'s save: rings centred on Nightshade, Nightshade, Mandrake, Foxglove', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), JSON.stringify(SAVE));
  await boot(page);
  const i = await page.evaluate(() => window.lwDebug.view().players.find((p) => p.you).hand.indexOf('Reagent_02'));
  await page.getByTestId(`hand-${i}`).tap();
  const card = page.getByTestId('gather-card');
  await expect(card).toBeVisible();
  await page.waitForTimeout(400);
  const box = await card.locator('img.gcard').boundingBox();
  const want = REAGENT_ICON_POS.Reagent_02.gather;
  for (const [n, [x, y]] of want.entries()) {
    const ring = await page.getByTestId(`hot-gather-${n}`).boundingBox();
    const dx = ring.x + ring.width / 2 - (box.x + x * box.width); const dy = ring.y + ring.height / 2 - (box.y + y * box.height);
    expect(Math.hypot(dx, dy), `ring ${n} off by ${dx.toFixed(1)}, ${dy.toFixed(1)}`).toBeLessThanOrEqual(TOLERANCE_PX);
  }
  await expect(page.locator('[data-testid^=hot-gather-]')).toHaveCount(4);
});
