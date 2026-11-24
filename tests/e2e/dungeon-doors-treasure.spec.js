// Dungeon entry doors, door/treasure SFX, and treasure sparkle on the last flipped treasure card.
import fs from 'fs';
import path from 'path';
import { test, expect } from './fixtures.js';
import { boot, watchErrors } from './helpers.js';
import {
  seekDungeonDoors,
  metricsAtClosedDoors,
  metricsMidDoorClearance,
  seekTreasureSparklePeak,
  removeDungeonDoors,
} from './dungeon-door-anim.js';

test.describe.configure({ retries: 2 });
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

test('entry doors cover the screen, swing open, leave the DOM, then the deck is tappable', async ({ page }) => {
  const errors = watchErrors(page);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await seedDungeonDeck(page, 'monster');
  await expect(page.getByTestId('dungeon')).toBeVisible();
  await expect(page.getByTestId('dungeon-entry-doors')).toBeVisible({ timeout: 8000 });
  const closedSeek = await seekDungeonDoors(page, 'closed');
  expect(closedSeek.ok, JSON.stringify(closedSeek)).toBe(true);
  const closedMetrics = await metricsAtClosedDoors(page);
  expect(closedMetrics.ok, JSON.stringify(closedMetrics)).toBe(true);
  await page.screenshot({ path: path.join(ARTIFACTS, 'dungeon-doors-closed-430.png'), scale: 'device' });
  const midSeek = await seekDungeonDoors(page, 'mid');
  expect(midSeek.ok, JSON.stringify(midSeek)).toBe(true);
  const midSwing = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="dungeon-entry-doors"]');
    if (!d) return { ok: false };
    const lf = d.querySelector('.dungeon-door-left .dungeon-door-face')?.getBoundingClientRect();
    const rf = d.querySelector('.dungeon-door-right .dungeon-door-face')?.getBoundingClientRect();
    const gap = lf && rf ? rf.left - lf.right : 0;
    const vw = window.innerWidth;
    const cy = window.innerHeight / 2;
    const cx = vw / 2;
    const deckVisible = !!document.elementFromPoint(cx, cy)?.closest?.('[data-testid="dungeon-deck"]');
    const left = d.querySelector('.dungeon-door-left');
    const tr = getComputedStyle(left).transform;
    let angleDeg = 0;
    const m = tr?.match(/matrix3d\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((s) => parseFloat(s.trim()));
      if (p.length >= 9) angleDeg = Math.abs((Math.asin(Math.min(1, Math.abs(p[8]))) * 180) / Math.PI);
    }
  const open = angleDeg >= 35;
    return { ok: gap > 20 && (deckVisible || open), gap, deckVisible, angleDeg, transform: tr };
  });
  expect(midSwing.ok, JSON.stringify(midSwing)).toBe(true);
  const midClear = await metricsMidDoorClearance(page);
  expect(midClear.ok, JSON.stringify(midClear)).toBe(true);
  await page.screenshot({ path: path.join(ARTIFACTS, 'dungeon-doors-mid-430.png'), scale: 'device' });
  await removeDungeonDoors(page);
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0);
  await expect(page.getByTestId('dungeon-leave')).toHaveText('Leave');
  const leaveUncovered = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="dungeon-leave"]');
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === btn || btn.contains(top);
  });
  expect(leaveUncovered).toBe(true);
  await page.getByTestId('dungeon').screenshot({
    path: path.join(ARTIFACTS, 'dungeon-open-after-doors-430.png'),
    scale: 'device',
  });
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0);
  await page.evaluate(() => window.lwDebug._g.sfx('door'));
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn').locator('.dc')).toHaveCount(1);
  await expect.poll(async () => audioPlays(page), { timeout: 3000 }).toContain('door');
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
  const peak = await seekTreasureSparklePeak(page);
  expect(peak.ok, JSON.stringify(peak)).toBe(true);
  await sparkle.screenshot({
    path: path.join(ARTIFACTS, 'dungeon-treasure-sparkle-430.png'),
    scale: 'device',
  });
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