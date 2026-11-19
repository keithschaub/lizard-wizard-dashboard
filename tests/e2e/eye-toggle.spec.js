import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot, watchErrors, tapEmptyBoard } from './helpers.js';

// Issue 148: the eye button (top left, every screen) shows the players' inventory over the current screen and
// returns to it unchanged. Saves: Keith's issue 143 save (round 31, his turn), four-player-spell-shield (opponents
// hold gold, LizWiz has Spell Shield), gather-ai (Newt's turn plays at load).
const fx = (n) => JSON.parse(fs.readFileSync(`tests/e2e/fixtures/${n}.json`, 'utf8'));

test.use({ viewport: { width: 430, height: 775 } });

async function open(page, save, { noAi = false } = {}) {
  await page.addInitScript(({ t, noAi }) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1');
    if (noAi) window.__noAi = true;
  }, { t: JSON.stringify(save), noAi });
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug);
  if (noAi) await page.evaluate(() => { window.lwDebug._g.aiStep = async () => false; });
  await page.waitForFunction(() => window.lwDebug.ready(), null, { timeout: 60_000 });
}

const eye = (page) => page.getByTestId('eye-toggle');
const inventory = (page) => page.getByTestId('inventory');

// The eye is the top element at its own centre, and covers no control or title on the screen below it.
async function eyeOnTop(page) {
  return page.evaluate(() => {
    const b = document.querySelector('.eye-toggle'); const e = b.getBoundingClientRect();
    const top = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2);
    const hits = [];
    const visible = (el) => {
      for (let x = el; x; x = x.parentElement) if (x.classList?.contains('out')) return false;
      const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const overlap = (r) => Math.min(e.right, r.right) - Math.max(e.left, r.left) > 0 && Math.min(e.bottom, r.bottom) - Math.max(e.top, r.top) > 0;
    for (const el of document.querySelectorAll('button, [role=button], .act, .ov-close, .hot, .chip, .tokchip, [data-tap], .chooser-head img, .mcard, .opt-card')) {
      if (el === b || !visible(el)) continue;
      const r = el.getBoundingClientRect(); if (r.width && overlap(r)) hits.push(el.dataset.testid || el.className);
    }
    for (const el of document.querySelectorAll('.ov-title, .phase-title, .mat-name, [data-testid=round], [data-testid=turn]')) {
      if (!visible(el)) continue;
      const range = document.createRange(); range.selectNodeContents(el);
      for (const r of range.getClientRects()) if (overlap(r)) { hits.push(`text "${el.textContent.trim().slice(0, 24)}"`); break; }
    }
    return { onTop: !!top?.closest('.eye-toggle'), hits, size: [Math.round(e.width), Math.round(e.height)], at: [Math.round(e.left), Math.round(e.top)] };
  });
}

async function expectEye(page, screen) {
  await expect(eye(page)).toBeVisible();
  const r = await eyeOnTop(page);
  expect(r.onTop, `${screen}: the eye is on top`).toBe(true);
  expect(r.hits, `${screen}: the eye covers nothing`).toEqual([]);
  expect(r.size).toEqual([40, 40]);
}

// Everything the player could see or the game could commit: overlays, dock, top bar, banner, engine view and save.
const snapshot = (page) => page.evaluate(() => ({
  overlays: document.getElementById('overlays').innerHTML,
  dock: document.getElementById('dock').innerHTML,
  top: document.getElementById('topbar').innerText,
  banner: document.getElementById('banner-layer').innerText,
  view: JSON.stringify(window.lwDebug.view()),
  save: localStorage.getItem('lw.save.v1'),
}));

async function roundTrip(page, how = 'eye') {
  await page.waitForTimeout(700);
  const before = await snapshot(page);
  await eye(page).tap();
  await expect(inventory(page)).toBeVisible();
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(400);
  if (how === 'eye') await eye(page).tap(); else await page.getByTestId('inventory-close').tap();
  await expect(inventory(page)).toHaveCount(0);
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);
  const after = await snapshot(page);
  for (const k of Object.keys(before)) expect(after[k], `${k} is unchanged`).toBe(before[k]);
}

function pendingEffect(save, spell, kind) {
  const s = structuredClone(save); s.meta.web_pending = { type: 'effect', spell, kind, queue: [] }; return s;
}
function invisibilityOnBoard(save) {
  const s = structuredClone(save); s.spell_face[0] = '/workspace/lizard-wizard/assets/Spell_Invisibility_Potion.jpg'; return s;
}
async function openXTarget(page) {
  await page.evaluate(() => { void window.ui.researchFlow(window.lwDebug._g, 'Spell_Invisibility_Potion', { groupIndex: 0 }); });
  await page.getByTestId('research-cast').tap();
  await expect(page.getByTestId('x-target-frame')).toBeVisible();
}

test('the eye is on top of every screen and overlay and covers nothing', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, fx('issue-143'), { noAi: true });
  await expectEye(page, 'board');
  const g = 'window.lwDebug._g';
  const screens = [
    ['game log', () => page.getByTestId('btn-log').tap()],
    ['menu', () => page.getByTestId('btn-menu').tap()],
    ['players sheet', () => tapEmptyBoard(page)],
    ['enlarged card', () => page.evaluate(`void window.ui.expandCard(${g}, ${g}.v.board.wiz_face[0])`)],
    ['deck view', () => page.locator('#board [data-tap=deck]').first().tap()],
    ['gather keep', () => page.evaluate(`void window.ui.gatherFlow(${g}, 'Reagent_05')`)],
    ['bidding arena', () => { page.evaluate(`void window.ui.arena(${g}, { mode: 'open', wizard: ${g}.v.board.wiz_face[0] })`); return page.getByTestId('bid-go').waitFor(); }],
    ['bug report', async () => { await page.getByTestId('btn-menu').tap(); await page.getByTestId('menu-bug-report').tap(); }],
  ];
  for (const [name, show] of screens) {
    await show();
    await page.waitForTimeout(600);
    await expectEye(page, name);
    await page.evaluate(() => window.ui.closeAll());
  }
  await page.close();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the eye is on top of the target pickers, the AI banner and the inventory itself', async ({ context }) => {
  let page = await context.newPage();
  await open(page, pendingEffect(fx('issue-143'), 'Spell_Disintegrate_N', 'disintegrate'), { noAi: true });
  await expect(page.getByTestId('effect')).toBeVisible();
  await page.waitForTimeout(600);
  await expectEye(page, 'Disintegrate target picker');
  await eye(page).tap();
  await expect(inventory(page)).toBeVisible();
  await page.waitForTimeout(400);
  await expectEye(page, 'inventory');
  await page.close();

  page = await context.newPage();
  await open(page, invisibilityOnBoard(fx('issue-143')), { noAi: true });
  await openXTarget(page);
  await page.waitForTimeout(500);
  await expectEye(page, 'Invisibility Potion player picker');
  await page.close();

  page = await context.newPage();
  await open(page, fx('gather-ai'));
  await expect(page.getByTestId('ai-banner')).toBeVisible({ timeout: 30_000 });
  await expectEye(page, 'AI banner');
  await page.close();
});

test('opening and closing the inventory leaves the screen and its state identical', async ({ context }) => {
  let page = await context.newPage();
  await open(page, fx('issue-143'), { noAi: true });
  await roundTrip(page);
  await page.evaluate(() => { void window.ui.gatherFlow(window.lwDebug._g, 'Reagent_05'); });
  await page.getByTestId('hot-gather-0').tap();
  await roundTrip(page);
  await expect(page.getByTestId('keep-counter')).toHaveText('1 / 3');
  await roundTrip(page, 'close');
  await page.close();

  page = await context.newPage();
  await open(page, pendingEffect(fx('issue-143'), 'Spell_Disintegrate_N', 'disintegrate'), { noAi: true });
  await expect(page.getByTestId('effect')).toBeVisible();
  await roundTrip(page);
  await roundTrip(page, 'close');
  await expect(page.getByTestId('effect-options').locator('button').first()).toBeEnabled();
  await page.close();

  page = await context.newPage();
  await open(page, invisibilityOnBoard(fx('issue-143')), { noAi: true });
  await openXTarget(page);
  await page.getByTestId('x-target-frame').locator('button', { hasText: '+' }).tap();
  await roundTrip(page);
  await page.close();

  page = await context.newPage();
  await open(page, fx('issue-143'), { noAi: true });
  await page.evaluate(() => { void window.ui.arena(window.lwDebug._g, { mode: 'open', wizard: window.lwDebug._g.v.board.wiz_face[0] }); });
  await page.getByTestId('bid-plus').tap();
  await roundTrip(page);
  await expect(page.getByTestId('bid-summary')).toContainText('2/');
  await page.close();
});

test('the keep overlay waits for the inventory to close before it commits', async ({ page }) => {
  await open(page, fx('issue-143'), { noAi: true });
  await page.evaluate(() => { void window.ui.gatherFlow(window.lwDebug._g, 'Reagent_05'); });
  if (await page.getByTestId('bloom-Horn').count()) await page.getByTestId('bloom-Horn').tap();
  await page.getByTestId('hot-gather-0').tap();
  await page.getByTestId('hot-gather-1').tap();
  const save = await page.evaluate(() => localStorage.getItem('lw.save.v1'));
  // The third tap fills the keep; the commit is due 260 ms later. The eye opens before it.
  await page.evaluate(() => { document.querySelector('[data-testid=hot-gather-2]').click(); document.querySelector('[data-testid=eye-toggle]').click(); });
  await expect(inventory(page)).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('keep-counter')).toHaveText('3 / 3');
  expect(await page.evaluate(() => localStorage.getItem('lw.save.v1')), 'nothing committed').toBe(save);
  await eye(page).tap();
  await expect(page.getByTestId('keep-counter')).toHaveCount(0, { timeout: 10_000 });
});

test('the AI turn pauses while the inventory is open and an eye tap never skips', async ({ page }) => {
  await open(page, fx('gather-ai'));
  const banner = page.getByTestId('ai-banner');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await eye(page).tap();
  await expect(inventory(page)).toBeVisible();
  expect(await page.evaluate(() => window.lwDebug._g.skipMove), 'the eye tap is not a skip').toBe(false);
  const at = await page.evaluate(() => ({ move: document.querySelector('#banner-layer .banner')?.dataset.move, log: window.lwDebug.view().log_len }));
  // Longer than one AI move (4.4 s) plus its gather flights.
  await page.waitForTimeout(7000);
  await expect(banner).toBeVisible();
  expect(await page.evaluate(() => ({ move: document.querySelector('#banner-layer .banner')?.dataset.move, log: window.lwDebug.view().log_len }))).toEqual(at);
  expect(await page.evaluate(() => window.lwDebug.aiRunning())).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#banner-layer .bprog')).animationPlayState)).toBe('paused');
  // Taps inside the inventory are not skips either.
  await page.getByTestId('inventory').tap({ position: { x: 200, y: 400 } });
  expect(await page.evaluate(() => window.lwDebug._g.skipMove)).toBe(false);
  await eye(page).tap();
  expect(await page.evaluate(() => window.lwDebug._g.skipMove), 'the closing eye tap is not a skip').toBe(false);
  await expect(banner).toBeVisible();
  await page.waitForFunction(() => !window.lwDebug.aiRunning(), null, { timeout: 30_000 });
});

test('a gather in flight keeps flying when the eye opens (no land-all)', async ({ page }) => {
  await open(page, fx('gather-many'), { noAi: true });
  const i = await page.evaluate(() => window.lwDebug.view().players.find((p) => p.you).hand.indexOf('Reagent_14'));
  await page.getByTestId(`hand-${i}`).tap();
  for (const hot of ['hot-gather-0', 'hot-gather-1', 'hot-gather-2']) await page.getByTestId(hot).tap();
  await page.waitForSelector('.gflight', { timeout: 10_000 });
  await eye(page).tap();
  await expect(inventory(page)).toBeVisible();
  expect(await page.locator('.gflight').count(), 'still flying after the eye tap').toBeGreaterThan(0);
  await eye(page).tap();
});

test('the bidding arena stops its playback while the inventory is open', async ({ page }) => {
  await open(page, fx('issue-143'), { noAi: true });
  const v = await page.evaluate(() => window.lwDebug.view());
  test.skip(!(v.legal.recruit || []).length, 'no wizard to recruit in this save');
  await page.evaluate((w) => { void window.ui.arena(window.lwDebug._g, { mode: 'open', wizard: w }); }, v.legal.recruit[0]);
  await page.getByTestId('bid-go').tap();
  await eye(page).tap();
  await expect(inventory(page)).toBeVisible();
  const bids = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^=bid-]')].filter((b) => b.classList.contains('bid')).map((b) => b.textContent).join('|'));
  const held = await bids();
  await page.waitForTimeout(3000);
  expect(await bids(), 'no AI bid shows while the inventory is open').toBe(held);
  await eye(page).tap();
  await expect.poll(bids, { timeout: 10_000 }).not.toBe(held);
});

test('inventory: opponents first, no opponent gold, shield state, no plus signs, no AI tag', async ({ page }) => {
  await open(page, fx('four-player-spell-shield'), { noAi: true });
  await eye(page).tap();
  const inv = inventory(page);
  await expect(inv).toBeVisible();
  const mats = await inv.locator('.mat').evaluateAll((ms) => ms.map((m) => m.dataset.testid));
  expect(mats).toEqual(['mat-inv-Newt', 'mat-inv-LizWiz', 'mat-inv-Gecko', 'mat-inv-Keith']);
  await expect(inv.locator('.stat.gold')).toHaveCount(1);
  await expect(inv.getByTestId('mat-inv-Keith').locator('.stat.gold')).toHaveCount(1);
  for (const n of ['Newt', 'LizWiz', 'Gecko']) await expect(inv.getByTestId(`mat-inv-${n}`).locator('.stat.gold')).toHaveCount(0);
  await expect(inv.getByTestId('shield-LizWiz')).toHaveText('Shielded');
  for (const n of ['Newt', 'Gecko', 'Keith']) await expect(inv.getByTestId(`shield-${n}`)).toHaveText('No shield');
  const text = await inv.innerText();
  expect(text).not.toMatch(/[+−]/);
  expect(text).not.toMatch(/\bAI\b/);
  await expect(inv.locator('.mat-tag')).toHaveText(['You']);
});

test('inventory is read-only: no gather, enlarge or other action from inside it', async ({ page }) => {
  await open(page, fx('issue-143'), { noAi: true });
  await eye(page).tap();
  const inv = inventory(page);
  await expect(inv).toBeVisible();
  await expect(inv.locator('button')).toHaveCount(1);
  await expect(inv.getByTestId('inventory-close')).toHaveCount(1);
  const save = await page.evaluate(() => localStorage.getItem('lw.save.v1'));
  const cards = inv.locator('.mcard:not(.empty)');
  const n = await cards.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++) {
    const c = cards.nth(i);
    if (!(await c.isVisible())) continue;
    await c.scrollIntoViewIfNeeded();
    await c.tap();
  }
  expect(await page.evaluate(() => document.querySelectorAll('#overlays .overlay').length), 'no overlay opened under the inventory').toBe(0);
  await expect(inv).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lw.save.v1'))).toBe(save);
});

test('cast picker, load and enlarged views do not wipe the inventory', async ({ page }) => {
  await open(page, fx('issue-143'), { noAi: true });
  await eye(page).tap();
  await expect(inventory(page)).toBeVisible();
  // The spell-effect picker opens with closeAll(): it does not touch the inventory.
  await page.evaluate(() => window.ui.closeAll());
  await expect(inventory(page)).toBeVisible();
  // A load replaces the players: the open inventory redraws with them.
  await page.evaluate(() => window.lwDebug._g.restart());
  await expect(inventory(page).getByTestId('mat-inv-Keith')).toBeVisible({ timeout: 20_000 });
  await expect(inventory(page).getByTestId('mat-inv-13InchesOfFun')).toHaveCount(0);
  await eye(page).tap();
  await expect(inventory(page)).toHaveCount(0);
});

test('enlarged card under the inventory survives an AI-turn close', async ({ page }) => {
  await open(page, fx('issue-143'), { noAi: true });
  await page.evaluate(() => { void window.ui.expandCard(window.lwDebug._g, window.lwDebug._g.v.board.wiz_face[0]); });
  await expect(page.getByTestId('expanded')).toBeVisible();
  await eye(page).tap();
  await page.evaluate(() => window.ui.closeExpandOverlays());
  await eye(page).tap();
  await expect(page.getByTestId('expanded')).toBeVisible();
});
