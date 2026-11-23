// Dungeon entry doors, door/treasure SFX, and treasure sparkle on the last flipped treasure card.
import fs from 'fs';
import path from 'path';
import { test, expect } from './fixtures.js';
import { boot, view, watchErrors } from './helpers.js';

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

const ARTIFACTS = '/opt/cursor/artifacts';

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
  await boot(page);
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
  await boot(page);
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

test('entry doors appear once, open, leave the DOM, then the deck is tappable', async ({ page }) => {
  const errors = watchErrors(page);
  const fk = await seedSummonDungeon(page);
  await openSummonDungeon(page, fk);
  const doors = page.getByTestId('dungeon-entry-doors');
  await expect(doors).toBeVisible({ timeout: 3000 });
  await expect.poll(async () => audioPlays(page), { timeout: 3000 }).toContain('door');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ARTIFACTS, 'dungeon-doors-opening-430.png') });
  await expect(doors).toHaveCount(0, { timeout: 1200 });
  await page.screenshot({ path: path.join(ARTIFACTS, 'dungeon-open-after-doors-430.png') });
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn').locator('.dc')).toHaveCount(1);
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0);
  const plays = await audioPlays(page);
  expect(plays).toContain('door');
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('no doors after a flip re-render', async ({ page }) => {
  const errors = watchErrors(page);
  await seedDungeonDeck(page, 'monster');
  await expect(page.getByTestId('dungeon')).toBeVisible();
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0, { timeout: 1200 });
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn').locator('.dc')).toHaveCount(1);
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0);
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('treasure flip plays treasure (not hit) and sparkle is only on the new card', async ({ page }) => {
  const errors = watchErrors(page);
  await seedDungeonDeck(page, 'treasure');
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0, { timeout: 1200 });
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn').locator('.dc')).toHaveCount(1);
  const row = page.getByTestId('dungeon-drawn');
  await expect(row.locator('.dc.treasure-sparkle')).toHaveCount(1);
  await expect(row.locator('.dc.monster.treasure-sparkle')).toHaveCount(0);
  await page.waitForTimeout(320);
  await page.screenshot({ path: path.join(ARTIFACTS, 'dungeon-treasure-sparkle-430.png') });
  const plays = await audioPlays(page);
  expect(plays.filter((n) => n === 'treasure').length).toBeGreaterThanOrEqual(1);
  expect(plays).not.toContain('hit');
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('monster flip plays hit not treasure and no sparkle class', async ({ page }) => {
  const errors = watchErrors(page);
  await seedDungeonDeck(page, 'monster');
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0, { timeout: 1200 });
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn').locator('.dc.monster')).toHaveCount(1);
  await expect(page.getByTestId('dungeon-drawn').locator('.treasure-sparkle')).toHaveCount(0);
  await page.waitForTimeout(320);
  const plays = await audioPlays(page);
  expect(plays).toContain('hit');
  expect(plays).not.toContain('treasure');
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});