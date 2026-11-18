import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// Issue #143. Keith's round 31 save (fixtures/issue-143.json). Cinzel Decorative's kern table pulls o·o, h·e and
// i·E a third to a half em together, so "BLOOM" collided; display text turns kerning off. Text on and around cards
// is at least 13 px.
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-143.json', 'utf8');
test.use({ viewport: { width: 430, height: 775 } });

async function open(page, save = SAVE) {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), save);
  await boot(page);
}
// Smallest font size and any Cinzel Decorative text still kerned, over the open overlays and banner.
const audit = (page) => page.evaluate(() => {
  const out = { small: [], kerned: [] };
  for (const root of document.querySelectorAll('#overlays .overlay:not(.out), #banner-layer .banner')) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement; const t = n.textContent.trim(); if (!t) continue;
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (!r.width || cs.visibility === 'hidden') continue;
      if (parseFloat(cs.fontSize) < 13) out.small.push(`${t} ${cs.fontSize}`);
      if (/Cinzel Decorative/.test(cs.fontFamily) && cs.fontKerning !== 'none') out.kerned.push(t);
    }
  }
  return out;
});

test('BLOOM: the two O letters no longer overlap', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.ui.gatherFlow(window.lwDebug._g, 'Reagent_05'));
  const boxes = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.phase-title')].find((e) => /bloom/i.test(e.textContent));
    const node = el.firstChild; const at = node.textContent.indexOf('oo');
    const range = document.createRange();
    return [at, at + 1].map((i) => { range.setStart(node, i); range.setEnd(node, i + 1); const r = range.getBoundingClientRect(); return [r.left, r.right]; });
  });
  expect(boxes[1][0], `second O starts at ${boxes[1][0]}, first ends at ${boxes[0][1]}`).toBeGreaterThanOrEqual(boxes[0][1] - 2);   // kerned it overlaps by about 7 px
  const a = await audit(page);
  expect(a.kerned).toEqual([]);
  expect(a.small).toEqual([]);
});

test('Gather (Miracle), Research and the AI gather banner keep every text at 13 px or more', async ({ page }) => {
  const s = JSON.parse(SAVE); s.players.find((p) => p.name === '13InchesOfFun').spells.push({ img: '/workspace/lizard-wizard/assets/Spell_Miracle.jpg', cast: true });
  await open(page, JSON.stringify(s));
  await page.evaluate(() => window.ui.gatherFlow(window.lwDebug._g, 'Reagent_16'));
  await expect(page.locator('.half-tag')).toBeVisible();
  let a = await audit(page); expect(a.small).toEqual([]); expect(a.kerned).toEqual([]);
  const tag = await page.locator('.half-tag').boundingBox();
  const card = await page.getByTestId('gather-card').boundingBox();
  expect((tag.y + tag.height / 2 - card.y) / card.height, 'Miracle tag sits between the halves').toBeLessThan(0.53);
  await page.evaluate(() => { window.ui.closeAll(); window.ui.researchFlow(window.lwDebug._g, 'Spell_Miracle', { groupIndex: 3 }); });
  await expect(page.getByTestId('research-cast')).toBeVisible();
  a = await audit(page); expect(a.small).toEqual([]);
});

test('AI gather banner text is 13 px or more', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), fs.readFileSync('tests/e2e/fixtures/gather-ai.json', 'utf8'));
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug);
  await page.evaluate(() => { window.lwDebug.gatherClock.hold = true; });
  await page.waitForSelector('#banner-layer [data-testid=ai-gather-after]:not(.reserved)', { timeout: 30_000 });
  const a = await audit(page);
  await page.evaluate(() => { window.lwDebug.gatherClock.hold = false; });
  expect(a.small).toEqual([]);
});
