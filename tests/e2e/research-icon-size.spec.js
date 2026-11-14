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

test('familiar New Research looks like the Research action (issue #123)', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), RESEARCH);
  await boot(page);
  await page.evaluate(() => { const g = window.lwDebug._g; window.ui.researchFlow(g, Object.keys(g.v.legal.research)[0]); });
  await expect(page.getByTestId('research-only')).toBeVisible();
  await page.waitForTimeout(500);
  const normal = await measure(page, 'expanded');

  const page2 = await page.context().newPage();
  await page2.addInitScript((t) => localStorage.setItem('lw.save.v1', t), NEW_RESEARCH);
  await boot(page2);
  const nr = page2.getByTestId('new-research');
  await expect(nr).toBeVisible();
  await page2.waitForTimeout(500);
  const m = await measure(page2, 'new-research');
  expectNormalSize(m);
  await expect(nr.locator('[data-testid=card-indicator] .dot')).toHaveCount(4);
  // WebKit occasionally lays the Research action's card out smaller (two buttons under it); New Research must
  // never come out smaller than it.
  expect(m.cardW, 'card at least as large as in the Research action').toBeGreaterThanOrEqual(normal.cardW - 2);

  const four = await page2.evaluate(() => window.lwDebug.view().pending.four);
  await nr.getByTestId('nav-next').click();
  await page2.waitForTimeout(400);
  await nr.getByTestId('nr-take').tap();
  await expect(nr).toHaveCount(0);
  await expect.poll(() => page2.evaluate(() => window.lwDebug.view().pending)).toBeNull();
  const mine = await page2.evaluate(() => window.lwDebug.view().players.find((p) => p.you).spells.map((x) => x.key || x));
  expect(JSON.stringify(mine)).toContain(four[1]);
  await page2.close();
});
