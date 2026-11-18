import fs from 'fs';
import { test, expect } from './fixtures.js';
import { watchErrors, tapEmptyBoard } from './helpers.js';

// Issue 150: the floating ? (next to the eye) opens the turn steps card over any screen: steps in rules order, the
// step in progress highlighted, actions that cannot be done now greyed. Saves: issue-123-research (Keith's round 23,
// storage 12/12, Spell Shield owned and castable after gathering Reagent 52), issue-143 (round 31), gather-ai
// (Newt's turn plays at load).
const fx = (n) => JSON.parse(fs.readFileSync(`tests/e2e/fixtures/${n}.json`, 'utf8'));

test.use({ viewport: { width: 430, height: 775 } });

async function open(page, save, { noAi = false } = {}) {
  await page.addInitScript((t) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1');
  }, JSON.stringify(save));
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug);
  if (noAi) await page.evaluate(() => { window.lwDebug._g.aiStep = async () => false; });
  await page.waitForFunction(() => window.lwDebug.ready(), null, { timeout: 60_000 });
}

const help = (page) => page.getByTestId('help-toggle');
const eye = (page) => page.getByTestId('eye-toggle');
const card = (page) => page.getByTestId('turn-card');

// Both floating buttons are the top element at their centres and cover no control, title or each other.
async function peeksOnTop(page) {
  return page.evaluate(() => {
    const out = [];
    const visible = (el) => {
      for (let x = el; x; x = x.parentElement) if (x.classList?.contains('out')) return false;
      const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    for (const b of document.querySelectorAll('.peek-btn')) {
      const e = b.getBoundingClientRect();
      const overlap = (r) => Math.min(e.right, r.right) - Math.max(e.left, r.left) > 0 && Math.min(e.bottom, r.bottom) - Math.max(e.top, r.top) > 0;
      const top = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2);
      if (!top?.closest('.peek-btn') || top.closest('.peek-btn') !== b) out.push(`${b.dataset.testid} not on top`);
      for (const el of document.querySelectorAll('button, [role=button], .act, .ov-close, .hot, .chip, .tokchip, [data-tap], .chooser-head img, .mcard, .opt-card')) {
        if (el === b || !visible(el)) continue;
        const r = el.getBoundingClientRect(); if (r.width && overlap(r)) out.push(`${b.dataset.testid} covers ${el.dataset.testid || el.className}`);
      }
      for (const el of document.querySelectorAll('.ov-title, .phase-title, .mat-name, .th-h, [data-testid=round], [data-testid=turn]')) {
        if (!visible(el)) continue;
        const range = document.createRange(); range.selectNodeContents(el);
        for (const r of range.getClientRects()) if (overlap(r)) { out.push(`${b.dataset.testid} covers text "${el.textContent.trim().slice(0, 24)}"`); break; }
      }
    }
    return out;
  });
}

async function expectPeeks(page, screen) {
  await expect(help(page)).toBeVisible();
  expect(await peeksOnTop(page), screen).toEqual([]);
}

const snapshot = (page) => page.evaluate(() => ({
  overlays: document.getElementById('overlays').innerHTML,
  dock: document.getElementById('dock').innerHTML,
  top: document.getElementById('topbar').innerText,
  banner: document.getElementById('banner-layer').innerText,
  view: JSON.stringify(window.lwDebug.view()),
  save: localStorage.getItem('lw.save.v1'),
}));

async function roundTrip(page, how = 'help') {
  await page.waitForTimeout(700);
  const before = await snapshot(page);
  await help(page).tap();
  await expect(card(page)).toBeVisible();
  await expect(help(page)).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(400);
  if (how === 'help') await help(page).tap();
  else if (how === 'close') await page.getByTestId('helper-close').tap();
  else await page.getByTestId('turn-helper').tap({ position: { x: 215, y: 768 } });
  await expect(page.getByTestId('turn-helper')).toHaveCount(0);
  await page.waitForTimeout(300);
  const after = await snapshot(page);
  for (const k of Object.keys(before)) expect(after[k], `${k} is unchanged`).toBe(before[k]);
}

async function gatherTo(page, card, keep) {
  await page.evaluate((k) => { void window.ui.gatherFlow(window.lwDebug._g, k); }, card);
  await expect(page.getByTestId('gather')).toBeVisible();
  const offers = await page.evaluate((k) => window.lwDebug.view().legal.gather[k].offers, card);
  const used = new Set();
  for (const r of keep) { const i = offers.findIndex((x, j) => x === r && !used.has(j)); used.add(i); await page.getByTestId(`hot-gather-${i}`).tap(); }
}

test('the ? is on top of every screen and overlay, next to the eye, and covers nothing', async ({ context }) => {
  let page = await context.newPage();
  const errors = watchErrors(page);
  await open(page, fx('issue-143'), { noAi: true });
  await expectPeeks(page, 'board');
  const g = 'window.lwDebug._g';
  const screens = [
    ['game log', () => page.getByTestId('btn-log').tap()],
    ['menu', () => page.getByTestId('btn-menu').tap()],
    ['players sheet', () => tapEmptyBoard(page)],
    ['enlarged card', () => page.evaluate(`void window.ui.expandCard(${g}, ${g}.v.board.wiz_face[0])`)],
    ['deck view', () => page.locator('#board [data-tap=deck]').first().tap()],
    ['gather keep', () => page.evaluate(`void window.ui.gatherFlow(${g}, 'Reagent_05')`)],
    ['bidding arena', () => { page.evaluate(`void window.ui.arena(${g}, { mode: 'open', wizard: ${g}.v.board.wiz_face[0] })`); return page.getByTestId('bid-go').waitFor(); }],
    ['research', () => page.evaluate(`void window.ui.researchFlow(${g}, ${g}.v.board.spell_face.find(Boolean).split('/').pop().replace('.jpg', ''), { groupIndex: 0 })`)],
    ['bug report', async () => { await page.getByTestId('btn-menu').tap(); await page.getByTestId('menu-bug-report').tap(); }],
  ];
  for (const [name, show] of screens) {
    await show();
    await page.waitForTimeout(600);
    await expectPeeks(page, name);
    await page.evaluate(() => window.ui.closeAll());
  }
  await help(page).tap();
  await page.waitForTimeout(500);
  await expectPeeks(page, 'turn card');
  await eye(page).tap();
  await page.waitForTimeout(500);
  await expectPeeks(page, 'inventory over the turn card');
  expect(errors, errors.join('\n')).toEqual([]);
  await page.close();

  page = await context.newPage();
  const s = fx('issue-143'); s.meta.web_pending = { type: 'effect', spell: 'Spell_Disintegrate_N', kind: 'disintegrate', queue: [] };
  await open(page, s, { noAi: true });
  await expect(page.getByTestId('effect')).toBeVisible();
  await page.waitForTimeout(600);
  await expectPeeks(page, 'Disintegrate target picker');
  await page.close();

  page = await context.newPage();
  await open(page, fx('gather-ai'));
  await expect(page.getByTestId('ai-banner')).toBeVisible({ timeout: 30_000 });
  await expectPeeks(page, 'AI banner');
  await page.close();
});

test('start of turn: rules order, step 1 now, actions the engine does not offer greyed', async ({ page }) => {
  await open(page, fx('issue-123-research'), { noAi: true });
  await help(page).tap();
  const c = card(page);
  await expect(c).toBeVisible();
  await expect(c.locator('.th-step .th-t')).toHaveText(['Pick one actionnow', 'Cast spells', 'Put back over storage', 'Claim achievements']);
  await expect(page.getByTestId('th-step-1')).toHaveClass(/cur/);
  for (const n of [2, 3, 4]) await expect(page.getByTestId(`th-step-${n}`)).not.toHaveClass(/cur/);
  const L = await page.evaluate(() => window.lwDebug.view().legal);
  const open_ = { gather: Object.keys(L.gather).length > 0, convert: Object.keys(L.convert).length > 0 || L.convert1, recruit: L.recruit.length > 0,
    research: Object.keys(L.research).length > 0, build: !!L.build, summon: Object.keys(L.summon).length > 0 };
  for (const [k, on] of Object.entries(open_)) expect(await page.getByTestId(`th-act-${k}`).getAttribute('data-off'), k).toBe(on ? null : '');
  expect(open_.build, 'this save has no build').toBe(false);
  await expect(page.getByTestId('th-act-research').locator('.log-value-chip.mana')).toHaveText(String(Math.min(...Object.values(L.research).map((d) => d.mana))));
  await expect(c).toContainText('After a gather');
  await expect(c).toContainText('Storage 12/12');
  const text = await c.innerText();
  expect(text).not.toMatch(/[+−]|'s\b/);
  await page.getByTestId('helper-close').tap();
  await expect(page.getByTestId('turn-helper')).toHaveCount(0);
  await help(page).tap();
  await page.getByTestId('turn-helper').tap({ position: { x: 215, y: 768 } });
  await expect(page.getByTestId('turn-helper')).toHaveCount(0);
});

test('mid-turn after a lost duel: step 1 is one more action', async ({ page }) => {
  await open(page, fx('issue-123-research'));
  const w = await page.evaluate(() => window.lwDebug.view().legal.recruit[0]);
  await page.evaluate((k) => { void window.ui.arena(window.lwDebug._g, { mode: 'open', wizard: k }); }, w);
  await page.getByTestId('bid-go').waitFor(); await page.waitForTimeout(800);
  await page.getByTestId('bid-go').tap();
  for (let i = 0; i < 80 && (await page.getByTestId('arena').count()); i++) {
    if (await page.getByTestId('bid-pass').isEnabled({ timeout: 300 }).catch(() => false)) await page.getByTestId('bid-pass').tap();
    await page.waitForTimeout(500);
  }
  await expect(page.getByTestId('arena')).toHaveCount(0, { timeout: 30_000 });
  const v = await page.evaluate(() => window.lwDebug.view());
  test.skip(v.next !== '13InchesOfFun', 'the duel was not lost');
  await help(page).tap();
  await expect(page.getByTestId('th-step-1')).toHaveClass(/cur/);
  await expect(page.getByTestId('th-step-1')).toContainText('One more action');
  await expect(card(page)).toContainText('Duel lost: take one more action');
});

test('over an overlay the card highlights the step in progress', async ({ page }) => {
  const s = fx('issue-123-research');
  s.players.find((p) => p.name === '13InchesOfFun').spells.push({ img: '/workspace/lizard-wizard/assets/Spell_Charm.jpg', cast: false });
  await open(page, s, { noAi: true });
  // Gather keep: step 1, Gather picked, the other actions greyed.
  await gatherTo(page, 'Reagent_52', []);
  await help(page).tap();
  await expect(page.getByTestId('th-step-1')).toHaveClass(/cur/);
  await expect(page.getByTestId('th-act-gather')).toHaveClass(/pick/);
  for (const k of ['convert', 'recruit', 'research', 'build', 'summon']) expect(await page.getByTestId(`th-act-${k}`).getAttribute('data-off')).toBe('');
  await help(page).tap();
  // Cast picker: step 2, each owned spell with its cost, greyed when this gather cannot pay for it.
  for (const r of ['Foxglove', 'Horn', 'Sulphur']) {
    const offers = await page.evaluate(() => window.lwDebug.view().legal.gather.Reagent_52.offers);
    await page.getByTestId(`hot-gather-${offers.indexOf(r)}`).tap();
  }
  await expect(page.getByTestId('cast-Spell_Spell_Shield_T')).toBeVisible({ timeout: 10_000 });
  await help(page).tap();
  await expect(page.getByTestId('th-step-2')).toHaveClass(/cur/);
  await expect(page.getByTestId('th-step-1')).not.toHaveClass(/cur/);
  const shield = page.getByTestId('th-spell-Spell_Spell_Shield_T');
  // Charm needs Mandrake ×3; one Mandrake is held and no Wizard adds Mandrake.
  const charm = page.getByTestId('th-spell-Spell_Charm');
  await expect(page.getByTestId('cast-Spell_Charm')).toHaveCount(0);
  expect(await shield.getAttribute('data-off')).toBeNull();
  expect(await charm.getAttribute('data-off')).toBe('');
  await expect(charm.locator('.log-reagent-chip')).toHaveText(['×2', '×3']);
  const school = await page.evaluate(() => window.lwDebug.cards().Spell_Charm.school);
  await expect(charm.locator('img.school')).toHaveAttribute('alt', school);
  await help(page).tap();
  // Skip the cast: storage is over, put-back is step 3.
  await page.getByTestId('skip-cast').tap();
  await expect(page.getByTestId('putback-pool')).toBeVisible();
  await help(page).tap();
  await expect(page.getByTestId('th-step-3')).toHaveClass(/cur/);
  await expect(page.getByTestId('th-step-3')).toContainText('put back');
});

test('opening the card leaves the screen and its state identical', async ({ context }) => {
  let page = await context.newPage();
  await open(page, fx('issue-123-research'), { noAi: true });
  await roundTrip(page);
  await gatherTo(page, 'Reagent_52', ['Foxglove']);
  await roundTrip(page, 'close');
  await expect(page.getByTestId('keep-counter')).toHaveText('1 / 3');
  for (const r of ['Horn', 'Sulphur']) {
    const offers = await page.evaluate(() => window.lwDebug.view().legal.gather.Reagent_52.offers);
    await page.getByTestId(`hot-gather-${offers.indexOf(r)}`).tap();
  }
  await expect(page.getByTestId('cast-Spell_Spell_Shield_T')).toBeVisible({ timeout: 10_000 });
  await roundTrip(page, 'scrim');
  await page.close();

  page = await context.newPage();
  await open(page, fx('issue-143'), { noAi: true });
  await page.evaluate(() => { void window.ui.arena(window.lwDebug._g, { mode: 'open', wizard: window.lwDebug._g.v.board.wiz_face[0] }); });
  await page.getByTestId('bid-plus').tap();
  await roundTrip(page);
  await expect(page.getByTestId('bid-summary')).toContainText('2/');
  await page.close();
});

test('the keep commit waits while the card is open', async ({ page }) => {
  await open(page, fx('issue-123-research'), { noAi: true });
  await gatherTo(page, 'Reagent_52', ['Foxglove', 'Horn']);
  const save = await page.evaluate(() => localStorage.getItem('lw.save.v1'));
  const i = await page.evaluate(() => window.lwDebug.view().legal.gather.Reagent_52.offers.indexOf('Sulphur'));
  await page.evaluate((j) => { document.querySelector(`[data-testid=hot-gather-${j}]`).click(); document.querySelector('[data-testid=help-toggle]').click(); }, i);
  await expect(card(page)).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('keep-counter')).toHaveText('3 / 3');
  expect(await page.evaluate(() => localStorage.getItem('lw.save.v1'))).toBe(save);
  await help(page).tap();
  await expect(page.getByTestId('keep-counter')).toHaveCount(0, { timeout: 10_000 });
});

test('the AI pauses while the card is open, a ? tap never skips, and the card names who is playing', async ({ page }) => {
  await open(page, fx('gather-ai'));
  const banner = page.getByTestId('ai-banner');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await help(page).tap();
  await expect(card(page)).toBeVisible();
  expect(await page.evaluate(() => window.lwDebug._g.skipMove)).toBe(false);
  await expect(page.getByTestId('th-who')).toHaveText('Newt is playing');
  for (const n of [1, 2, 3, 4]) await expect(page.getByTestId(`th-step-${n}`)).not.toHaveClass(/cur/);
  const at = await page.evaluate(() => ({ move: document.querySelector('#banner-layer .banner')?.dataset.move, log: window.lwDebug.view().log_len }));
  await page.waitForTimeout(7000);
  expect(await page.evaluate(() => ({ move: document.querySelector('#banner-layer .banner')?.dataset.move, log: window.lwDebug.view().log_len }))).toEqual(at);
  expect(await page.evaluate(() => window.lwDebug.aiRunning())).toBe(true);
  await card(page).tap();
  expect(await page.evaluate(() => window.lwDebug._g.skipMove)).toBe(false);
  // The eye works over the card; the game waits until both are closed.
  await eye(page).tap();
  await expect(page.getByTestId('inventory')).toBeVisible();
  await eye(page).tap();
  await expect(card(page)).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.lwDebug.view().log_len)).toBe(at.log);
  await help(page).tap();
  expect(await page.evaluate(() => window.lwDebug._g.skipMove)).toBe(false);
  await page.waitForFunction(() => !window.lwDebug.aiRunning(), null, { timeout: 30_000 });
});

test('the bidding arena stops its playback while the card is open', async ({ page }) => {
  await open(page, fx('issue-143'), { noAi: true });
  const v = await page.evaluate(() => window.lwDebug.view());
  await page.evaluate((w) => { void window.ui.arena(window.lwDebug._g, { mode: 'open', wizard: w }); }, v.legal.recruit[0]);
  await page.getByTestId('bid-go').tap();
  await help(page).tap();
  await expect(card(page)).toBeVisible();
  await expect(page.getByTestId('th-act-recruit')).toHaveClass(/pick/);
  const bids = () => page.evaluate(() => [...document.querySelectorAll('.bid')].map((b) => b.textContent).join('|'));
  const held = await bids();
  await page.waitForTimeout(3000);
  expect(await bids()).toBe(held);
  await help(page).tap();
  await expect.poll(bids, { timeout: 10_000 }).not.toBe(held);
});
