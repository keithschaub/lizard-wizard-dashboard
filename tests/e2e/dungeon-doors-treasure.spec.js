// Dungeon entry doors, door/treasure SFX, and treasure sparkle on the last flipped treasure card.
test.describe.configure({ retries: 2 });
import fs from 'fs';
import path from 'path';
import { test, expect } from './fixtures.js';
import { boot, view, watchErrors } from './helpers.js';

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

const ARTIFACTS = '/opt/cursor/artifacts';

async function prep(page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await boot(page);
}

async function spyAudio(page) {
  await page.evaluate(() => {
    window.__audioPlays = [];
    const g = window.lwDebug._g;
    const orig = g.sfx.bind(g);
    g.sfx = (n) => { window.__audioPlays.push(n); return orig(n); };
  });
}

async function audioPlays(page) {
  return page.evaluate(() => window.__audioPlays || []);
}

async function seedDungeonDeck(page, topType) {
  await prep(page);
  await spyAudio(page);
  return page.evaluate(async (topTypeIn) => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const fam = s.fam_face.find(Boolean);
    if (!fam) throw new Error('no familiar on board');
    const via = fam.split('/').pop().replace(/\.jpg$/, '');
    const top = topTypeIn === 'treasure'
      ? { deck: 'Dungeon', type: 'Treasure', subtype: 'Gold', gold: 1, text: 'Collect 1 Gold' }
      : { deck: 'Dungeon', type: 'Monster', name: 'Orc', monster_type: 'Goblinoid' };
    const filler = { deck: 'Dungeon', type: 'Treasure', subtype: 'Gold', gold: 1, text: 'Collect 1 Gold' };
    s.dungeon_list = [top, ...Array(20).fill(filler)];
    const me = s.players.find((p) => p.name === 'Keith');
    me.mana = 50;
    me.gold = 0;
    s.next = 'Keith';
    s.meta.web_pending = { type: 'dungeon', via, draws: 0 };
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    window.lwDebug._g.aiStep = async () => false;
    void window.ui.dungeonFlow(window.lwDebug._g);
    return via;
  }, topType);
}

async function seedSummonDungeon(page) {
  await prep(page);
  await spyAudio(page);
  return page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const me = s.players.find((p) => p.name === 'Keith');
    me.mana = 50;
    me.gold = 0;
    me.wizards = [];
    me.spells = [];
    s.next = 'Keith';
    s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    window.lwDebug._g.aiStep = async () => false;
    const fk = r.result.board.fam_face.find(Boolean);
    return fk;
  });
}

async function openSummonDungeon(page, fk) {
  const v = await view(page);
  const idx = v.board.fam_face.indexOf(fk);
  await page.getByTestId(`slot-fam_${idx}`).tap();
  await expect(page.getByTestId('summon-use')).toBeVisible();
  await page.getByTestId('summon-dungeon').tap();
  await expect(page.getByTestId('dungeon')).toBeVisible();
}

test('entry doors cover the screen, swing open, leave the DOM, then the deck is tappable', async ({ page }) => {
  const errors = watchErrors(page);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await seedDungeonDeck(page, 'monster');
  await expect(page.getByTestId('dungeon')).toBeVisible();
  await expect(page.getByTestId('dungeon-entry-doors')).toBeVisible({ timeout: 8000 });
  const t0 = await page.evaluate(() => Number(document.querySelector('[data-testid="dungeon-entry-doors"]').dataset.t0));
  const closedMetrics = await page.evaluate(async (t0In) => {
    const wait = Math.max(0, t0In + 50 - performance.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const d = document.querySelector('[data-testid="dungeon-entry-doors"]');
    const ov = document.querySelector('[data-testid="dungeon"]');
    const deck = document.querySelector('[data-testid="dungeon-deck"]');
    if (!d || !ov || !deck) return { ok: false, reason: 'missing-nodes' };
    const dr = d.getBoundingClientRect();
    const coverage = dr.width / ov.getBoundingClientRect().width;
    const dcr = deck.getBoundingClientRect();
    const cx = dcr.left + dcr.width / 2;
    const cy = dcr.top + dcr.height / 2;
    const ix = Math.max(0, Math.min(dr.right, dcr.right) - Math.max(dr.left, dcr.left));
    const iy = Math.max(0, Math.min(dr.bottom, dcr.bottom) - Math.max(dr.top, dcr.top));
    const overlap = (ix * iy) / Math.max(1, dcr.width * dcr.height);
    const stack = document.elementsFromPoint(cx, cy);
    const doorIx = stack.findIndex((el) => el.closest?.('[data-testid="dungeon-entry-doors"], .dungeon-door-face, .dungeon-door-leaf'));
    const deckIx = stack.findIndex((el) => el.closest?.('[data-testid="dungeon-deck"]'));
    const hitDoor = (doorIx >= 0 && (deckIx < 0 || doorIx < deckIx))
      || (coverage >= 0.98 && overlap >= 0.95);
    const lf = d.querySelector('.dungeon-door-left .dungeon-door-face')?.getBoundingClientRect();
    const rf = d.querySelector('.dungeon-door-right .dungeon-door-face')?.getBoundingClientRect();
    const seamClosed = lf && rf && rf.left - lf.right <= 8;
    return {
      ok: coverage >= 0.8 && overlap >= 0.85 && hitDoor && dr.height > 80 && seamClosed,
      coverage, overlap, hitDoor, doorH: dr.height,
    };
  }, t0);
  expect(closedMetrics.ok, JSON.stringify(closedMetrics)).toBe(true);
  await page.getByTestId('dungeon').screenshot({
    path: path.join(ARTIFACTS, 'dungeon-doors-closed-430.png'),
    animations: 'disabled',
  });
  await page.evaluate(async (t0In) => {
    const wait = Math.max(0, t0In + 520 - performance.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }, t0);
  if (await page.getByTestId('dungeon-entry-doors').count()) {
    const midMetrics = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="dungeon-entry-doors"]');
      if (!d) return { ok: false, reason: 'gone' };
      const lf = d.querySelector('.dungeon-door-left .dungeon-door-face')?.getBoundingClientRect();
      const rf = d.querySelector('.dungeon-door-right .dungeon-door-face')?.getBoundingClientRect();
      const gap = lf && rf ? rf.left - lf.right : 0;
      return {
        ok: d.dataset.doorPhase === 'opening' || gap > 1,
        gap,
        phase: d.dataset.doorPhase,
      };
    });
    expect(midMetrics.ok, JSON.stringify(midMetrics)).toBe(true);
    await page.getByTestId('dungeon').screenshot({
      path: path.join(ARTIFACTS, 'dungeon-doors-mid-430.png'),
      animations: 'disabled',
    });
  }
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0, { timeout: 4000 });
  await page.getByTestId('dungeon').screenshot({
    path: path.join(ARTIFACTS, 'dungeon-open-after-doors-430.png'),
    animations: 'disabled',
  });
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn').locator('.dc')).toHaveCount(1);
  await expect.poll(async () => audioPlays(page), { timeout: 8000 }).toContain('door');
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('no doors after a flip re-render', async ({ page }) => {
  const errors = watchErrors(page);
  await seedDungeonDeck(page, 'monster');
  await expect(page.getByTestId('dungeon')).toBeVisible();
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0, { timeout: 4000 });
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn').locator('.dc')).toHaveCount(1);
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0);
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('treasure flip plays treasure (not hit) and sparkle is visible on the new card', async ({ page }) => {
  const errors = watchErrors(page);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await seedDungeonDeck(page, 'treasure');
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0, { timeout: 4000 });
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn').locator('.dc')).toHaveCount(1);
  const row = page.getByTestId('dungeon-drawn');
  const sparkle = row.locator('.dc.treasure-sparkle');
  await expect(sparkle).toHaveCount(1);
  await expect(row.locator('.dc.monster.treasure-sparkle')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const cell = document.querySelector('.dc.treasure-sparkle');
    const spark = cell?.querySelector('.treasure-spark.s1');
    if (!cell || !spark) return JSON.stringify({ ok: false, reason: 'no sparkle nodes' });
    const cs = getComputedStyle(spark);
    const cellCs = getComputedStyle(cell);
    const sr = spark.getBoundingClientRect();
    const rimOk = cellCs.boxShadow !== 'none' && cellCs.boxShadow.includes('235');
    const sparkOk = Number(cs.opacity) >= 0.45 && sr.width >= 7;
    return JSON.stringify({
      ok: rimOk && sparkOk, opacity: cs.opacity, sparkW: sr.width, shadow: cellCs.boxShadow,
    });
  }), { timeout: 3000 }).toContain('"ok":true');
  await page.getByTestId('dungeon-drawn').screenshot({ path: path.join(ARTIFACTS, 'dungeon-treasure-sparkle-430.png') });
  const plays = await audioPlays(page);
  expect(plays.filter((n) => n === 'treasure').length).toBeGreaterThanOrEqual(1);
  expect(plays).not.toContain('hit');
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('monster flip plays hit not treasure and no sparkle class', async ({ page }) => {
  const errors = watchErrors(page);
  await seedDungeonDeck(page, 'monster');
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0, { timeout: 4000 });
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn').locator('.dc.monster')).toHaveCount(1);
  await expect(page.getByTestId('dungeon-drawn').locator('.treasure-sparkle')).toHaveCount(0);
  await page.waitForTimeout(320);
  const plays = await audioPlays(page);
  expect(plays).toContain('hit');
  expect(plays).not.toContain('treasure');
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});