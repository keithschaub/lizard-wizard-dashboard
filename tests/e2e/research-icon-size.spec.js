import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// Issue #123. fixtures/issue-123-research.json: Keith's round 23 save (40 mana) on his turn.
// fixtures/issue-123-new-research.json: the same save after summoning Aranea for New Research (four spells pending).
// A familiar's New Research must look like the Research action: one spell in the shared carousel, the research
// action frame, no card-info text panel, and chips at their normal size.
const RESEARCH = fs.readFileSync('tests/e2e/fixtures/issue-123-research.json', 'utf8');
const NEW_RESEARCH = fs.readFileSync('tests/e2e/fixtures/issue-123-new-research.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

// Wait for the card's open animation to finish: its width must hold for a few frames.
async function settled(page, testid) {
  await page.waitForFunction((testid) => {
    const img = document.querySelector(`[data-testid="${testid}"]:not(.out) [data-testid=expanded-img]`);
    const w = img ? Math.round(img.getBoundingClientRect().width) : 0;
    const prev = window.__w; window.__w = w;
    window.__same = w > 0 && w === prev ? (window.__same || 0) + 1 : 0;
    return window.__same >= 5;
  }, testid, { polling: 100, timeout: 10_000 });
}

async function measure(page, testid) {
  await settled(page, testid);
  return page.evaluate((testid) => {
    const ov = document.querySelector(`[data-testid="${testid}"]:not(.out)`);
    const box = (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; };
    const card = ov.querySelector('[data-testid=expanded-img]');
    const visible = (e) => e && !e.closest('[hidden]') && box(e).w > 0;
    const others = [...ov.querySelectorAll('img')].filter((i) => visible(i) && i !== card && !i.closest('.big-frame'));
    return {
      cardW: card ? box(card).w : 0,
      chipIcons: [...ov.querySelectorAll('[class*=chip] img')].filter(visible).map((i) => Math.max(box(i).w, box(i).h)),
      otherImgs: others.map((i) => ({ src: i.getAttribute('src'), w: box(i).w })),
      frame: !!ov.querySelector('.research-action-frame'),
      cardText: [...ov.querySelectorAll('.ci-text, .oc-label')].filter(visible).length,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  }, testid);
}

function expectNormalSize(m) {
  expect(m.cardW).toBeGreaterThan(100);
  expect(m.chipIcons.every((w) => w <= 32), `chip icons ${m.chipIcons}`).toBe(true);
  for (const o of m.otherImgs) expect(o.w, `${o.src} stays below a third of the card`).toBeLessThanOrEqual(m.cardW / 3);
  expect(m.frame).toBe(true);
  expect(m.cardText, 'no card-info text panel repeating the card').toBe(0);
  expect(m.overflow).toBeLessThanOrEqual(0);
}

test('Research action: spell carousel with normal-size chips', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), RESEARCH);
  await boot(page);
  await page.evaluate(() => { const g = window.lwDebug._g; window.ui.researchFlow(g, Object.keys(g.v.legal.research)[0]); });
  await expect(page.getByTestId('research-only')).toBeVisible();
  await page.waitForTimeout(500);
  const m = await measure(page, 'expanded');
  expectNormalSize(m);
  expect(m.chipIcons.length).toBeGreaterThan(0);
});

test('familiar New Research shows its four spells with normal-size icons (issues #123, #128)', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), NEW_RESEARCH);
  await boot(page);
  const nr = page.getByTestId('new-research');
  await expect(nr.locator('.nr-card')).toHaveCount(4);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const ov = document.querySelector('[data-testid="new-research"]:not(.out)');
    const box = (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; };
    const cards = [...ov.querySelectorAll('.nr-card')];
    const arts = cards.map((c) => c.querySelector('img'));
    return {
      cardW: Math.min(...cards.map((c) => box(c).w)),
      artW: arts.map((i) => box(i).w),
      others: [...ov.querySelectorAll('img')].filter((i) => !arts.includes(i)).map((i) => ({ src: i.getAttribute('src'), w: box(i).w })),
      chipIcons: [...ov.querySelectorAll('[class*=chip] img')].map((i) => Math.max(box(i).w, box(i).h)),
      frame: !!ov.querySelector('.research-action-frame [data-testid=nr-take]'),
      cardText: ov.querySelectorAll('.ci-text, .oc-label, .cardinfo').length,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(m.cardW).toBeGreaterThan(100);
  for (const w of m.artW) expect(w, 'card art fills its frame, not a medallion or tile').toBeGreaterThan(m.cardW * 0.85);
  expect(m.chipIcons.every((w) => w <= 32), `chip icons ${m.chipIcons}`).toBe(true);
  for (const o of m.others) expect(o.w, `${o.src} stays below a third of a card`).toBeLessThanOrEqual(m.cardW / 3);
  expect(m.frame, 'Research button in the research action frame').toBe(true);
  expect(m.cardText, 'no card-info text panel').toBe(0);
  expect(m.overflow).toBeLessThanOrEqual(0);
});
