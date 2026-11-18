import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot, watchErrors } from './helpers.js';

// Gather animation (storyboards approved by Keith). Saves built from issue 135's round 26 save:
// gather-basic (Reagent 14, no Wizards), gather-many (6 Wizards: 9 reagents), gather-miracle (Miracle cast,
// Reagent 34 bottom half), gather-ai (Newt: Maximum Gather, 1 Wizard, only Reagent 13 in hand, nothing else to do),
// issue-135-scry-familiar (Corvum: 5 Nightshade, no Nightshade chip yet).
const fx = (n) => fs.readFileSync(`tests/e2e/fixtures/${n}.json`, 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

async function open(page, save) {
  await page.addInitScript((t) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1');
  }, save);
  await boot(page);
}

// Records every change to the dock, the AI banner chips and the price markers, and each flight that lands
// (a flying icon leaves the page as it lands).
async function watch(page) {
  await page.evaluate(() => {
    const W = window.__gw = { landed: {}, order: [], total: 0, samples: [], firstFlight: null, lastLanding: null };
    const read = () => {
      const d = document.querySelector('#dock');
      const chips = {};
      d?.querySelectorAll('.tokchip').forEach((c) => { if (!c.classList.contains('reserved')) chips[c.dataset.testid.slice(6)] = Number(c.querySelector('.tokn').textContent.slice(1)); });
      const tracks = {};
      document.querySelectorAll('#board .marker').forEach((m) => { tracks[m.dataset.testid.slice(6)] = m.dataset.v; });
      const banner = {};
      document.querySelectorAll('#banner-layer [data-reagent]').forEach((c) => {
        if (c.classList.contains('reserved')) return;
        const t = c.querySelector('.bgather-count, .log-reagent-count')?.textContent;
        banner[c.dataset.reagent] = t ? Number(t.slice(1)) : 1;
      });
      const after = document.querySelector('#banner-layer [data-testid=ai-gather-after]');
      return {
        chips, tracks, banner, store: Number(d?.querySelector('[data-testid=my-storage]')?.textContent.split('/')[0] ?? 0),
        afterShown: after ? !after.classList.contains('reserved') : null,
        turn: document.querySelector('[data-testid=turn]')?.textContent, flying: document.querySelectorAll('.gflight').length,
      };
    };
    W.base = read();
    new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) if (n.classList?.contains('gflight')) W.firstFlight ??= performance.now();
        for (const n of r.removedNodes) {
          if (!n.classList?.contains('gflight')) continue;
          W.landed[n.dataset.reagent] = (W.landed[n.dataset.reagent] || 0) + 1; W.total += 1; W.order.push(n.dataset.reagent);
          W.lastLanding = performance.now();
        }
      }
      W.samples.push({ ...read(), landed: { ...W.landed }, total: W.total });
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-v'] });
  });
}

const settled = (page) => page.waitForFunction(() => !window.lwDebug._g.tokHold && !document.querySelector('.gflight') && window.__gw.total > 0, null, { timeout: 30_000 });
const result = (page) => page.evaluate(() => window.__gw);

// The dock never shows a reagent, a storage slot or a price step before the flight that brings it lands,
// and keeps saying "Your turn" until the last one lands.
function expectHeldUntilLanding(W, n) {
  for (const s of W.samples) {
    for (const [r, c] of Object.entries(s.chips)) expect(c - (W.base.chips[r] || 0), `${r} ×${c} with ${s.landed[r] || 0} landed`).toBeLessThanOrEqual(s.landed[r] || 0);
    expect(s.store - W.base.store, `storage ${s.store} with ${s.total} landed`).toBeLessThanOrEqual(s.total);
    if (s.total < n) {
      expect(s.tracks, 'price markers wait for the last landing').toEqual(W.base.tracks);
      expect(s.turn).toBe('Your turn');
    }
  }
}

async function expectEngineState(page) {
  const got = await page.evaluate(() => {
    const me = window.lwDebug.view().players.find((p) => p.you);
    const want = {}; for (const r of me.tok) want[r] = (want[r] || 0) + 1;
    const chips = {};
    document.querySelectorAll('#dock .tokchip').forEach((c) => { if (!c.classList.contains('reserved')) chips[c.dataset.testid.slice(6)] = Number(c.querySelector('.tokn').textContent.slice(1)); });
    const tracks = {}; document.querySelectorAll('#board .marker').forEach((m) => { tracks[m.dataset.testid.slice(6)] = Number(m.dataset.v); });
    return {
      chips, want, tracks, wantTracks: window.lwDebug.view().board.tracks,
      store: document.querySelector('[data-testid=my-storage]').textContent, wantStore: `${me.tok.length}/${me.cap}`,
      mana: document.querySelector('[data-testid=my-mana]').textContent.trim(), wantMana: String(me.mana),
    };
  });
  expect(got.chips).toEqual(got.want);
  expect(got.store).toBe(got.wantStore);
  expect(got.mana).toBe(got.wantMana);
  for (const [r, v] of Object.entries(got.tracks)) expect(v, `${r} track`).toBe(Math.max(1, Math.min(12, got.wantTracks[r])));
}

async function gatherFromHand(page, card, hots) {
  const i = await page.evaluate((k) => window.lwDebug.view().players.find((p) => p.you).hand.indexOf(k), card);
  await page.getByTestId(`hand-${i}`).tap();
  await expect(page.getByTestId('gather')).toBeVisible();
  for (const hot of hots) await page.getByTestId(hot).tap();
}

test('basic: Mandrake, Toadstool, Eye of Newt fly 250 ms apart and tick the dock on landing', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, fx('gather-basic'));
  await watch(page);
  await gatherFromHand(page, 'Reagent_14', ['hot-gather-0', 'hot-gather-1', 'hot-gather-2']);
  await settled(page);
  const W = await result(page);
  expect(W.order).toEqual(['Mandrake', 'Toadstool', 'Eye_of_Newt']);
  expect(W.lastLanding - W.firstFlight).toBeGreaterThan(900);
  expect(W.lastLanding - W.firstFlight).toBeLessThan(1400);
  expectHeldUntilLanding(W, 3);
  await expectEngineState(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('nine reagents (6 Wizards) finish within 2 s', async ({ page }) => {
  await open(page, fx('gather-many'));
  await watch(page);
  await gatherFromHand(page, 'Reagent_14', ['hot-gather-0', 'hot-gather-1', 'hot-gather-2']);
  await settled(page);
  const W = await result(page);
  expect(W.order).toEqual(['Mandrake', 'Toadstool', 'Eye_of_Newt', 'Eye_of_Newt', 'Mandrake', 'Sulphur', 'Foxglove', 'Horn', 'Toadstool']);
  expect(W.lastLanding - W.firstFlight).toBeLessThan(1750 + 250);
  expectHeldUntilLanding(W, 9);
  await expectEngineState(page);
});

test('Corvum via Scry Familiar: 5 Nightshade stream in and the new chip appears on the first landing', async ({ page }) => {
  await open(page, fx('issue-135-scry-familiar'));
  await expect(page.getByTestId('rise-use')).toBeVisible({ timeout: 30_000 });
  await watch(page);
  await page.getByTestId('rise-gather').tap();
  await settled(page);
  const W = await result(page);
  expect(W.order).toEqual(Array(5).fill('Nightshade'));
  expect(W.base.chips.Nightshade).toBeUndefined();
  expect(W.samples.some((s) => s.flying && !s.chips.Nightshade), 'no Nightshade chip while the first is in flight').toBe(true);
  expectHeldUntilLanding(W, 5);
  const last = await page.locator('#dock .tokchip:not(.reserved)').last().getAttribute('data-testid');
  expect(last).toBe('token-Nightshade');
  await expectEngineState(page);
});

test('Miracle: the Increase Value half flies (Sulphur ×2, Mandrake)', async ({ page }) => {
  await open(page, fx('gather-miracle'));
  await watch(page);
  await gatherFromHand(page, 'Reagent_34', ['hot-increase-0', 'hot-increase-1', 'hot-increase-2']);
  await settled(page);
  const W = await result(page);
  expect(W.order).toEqual(['Sulphur', 'Sulphur', 'Mandrake']);
  expectHeldUntilLanding(W, 3);
  await expectEngineState(page);
});

test('AI: Newt gathers into the banner chips, Tracks up only after the last landing', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), fx('gather-ai'));
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug);
  await watch(page);
  await page.waitForFunction(() => window.__gw.total >= 6, null, { timeout: 60_000 });
  const W = await result(page);
  const order = ['Eye_of_Newt', 'Horn', 'Eye_of_Newt', 'Eye_of_Newt', 'Nightshade', 'Toadstool'];
  expect(W.order.slice(0, 6)).toEqual(order);
  for (const s of W.samples) {
    if (s.afterShown === null) continue;
    for (const [r, c] of Object.entries(s.banner)) expect(c, `banner ${r}`).toBeLessThanOrEqual(s.landed[r] || 0);
    if (s.total < 6) expect(s.afterShown, 'Tracks up waits for the last landing').toBe(false);
  }
  const final = W.samples.filter((s) => s.afterShown).pop();
  expect(final.banner).toEqual({ Eye_of_Newt: 3, Horn: 1, Nightshade: 1, Toadstool: 1 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a tap lands everything at once with the final counts', async ({ page }) => {
  await open(page, fx('gather-many'));
  await watch(page);
  await gatherFromHand(page, 'Reagent_14', ['hot-gather-0', 'hot-gather-1', 'hot-gather-2']);
  await page.waitForFunction(() => window.__gw.firstFlight && performance.now() - window.__gw.firstFlight > 300);
  await page.mouse.click(215, 300);
  await page.waitForFunction(() => !window.lwDebug._g.tokHold, null, { timeout: 2_000 });
  const W = await result(page);
  expect(W.lastLanding - W.firstFlight, 'nothing flies after the tap').toBeLessThan(800);
  await expect(page.locator('.gflight')).toHaveCount(0);
  await expectEngineState(page);
});

test('reduced motion: no flights, final counts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, fx('gather-basic'));
  await watch(page);
  await gatherFromHand(page, 'Reagent_14', ['hot-gather-0', 'hot-gather-1', 'hot-gather-2']);
  await page.waitForFunction(() => window.lwDebug.view().players.find((p) => p.you).tok.length === 14 && !window.lwDebug._g.tokHold);
  const W = await result(page);
  expect(W.firstFlight).toBeNull();
  await expectEngineState(page);
});

test('a reload mid-animation ends in the final state', async ({ page }) => {
  await open(page, fx('gather-basic'));
  await watch(page);
  await gatherFromHand(page, 'Reagent_14', ['hot-gather-0', 'hot-gather-1', 'hot-gather-2']);
  await page.waitForFunction(() => window.__gw.firstFlight);
  await page.reload();
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  await expect(page.locator('.gflight')).toHaveCount(0);
  await expect(page.getByTestId('my-storage')).toHaveText('14/24');
  await expectEngineState(page);
});

test('gather and cast: every reagent lands first, then the cast cost leaves the dock', async ({ page }) => {
  const s = JSON.parse(fx('issue-135-scry-familiar'));
  s.players.find((p) => p.name === '13InchesOfFun').tok.push('Foxglove');   // Disintegrate: Foxglove ×2, Nightshade ×2
  await open(page, JSON.stringify(s));
  await expect(page.getByTestId('rise-use')).toBeVisible({ timeout: 30_000 });
  await watch(page);
  await page.getByTestId('rise-gather').tap();
  const flow = page.getByTestId('rise-gather-flow');
  await flow.getByTestId('cast-Spell_Disintegrate_N').tap();
  await flow.getByTestId('skip-cast').tap();
  await settled(page);
  await expect(page.getByTestId('effect')).toBeVisible({ timeout: 30_000 });
  const W = await result(page);
  expectHeldUntilLanding(W, 5);
  const stores = W.samples.map((x) => x.store);
  const peak = stores.indexOf(W.base.store + 5);
  expect(peak, 'storage reaches the full gather before anything is spent').toBeGreaterThan(-1);
  expect(stores.slice(0, peak).every((v, i, a) => !i || v >= a[i - 1]), 'no token leaves before the last landing').toBe(true);
  expect(stores[stores.length - 1]).toBe(W.base.store + 5 - 4);
  await expectEngineState(page);
});
