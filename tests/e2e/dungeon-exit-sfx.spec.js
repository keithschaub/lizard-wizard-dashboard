// Dungeon exit: overlay plays door-close on stop (not hit/coin); success loot adds one delayed coin.
import { test, expect } from './fixtures.js';
import { boot, watchErrors } from './helpers.js';

test.use({ viewport: { width: 430, height: 775 } });

async function spyAudioAndBanners(page) {
  await page.evaluate(() => {
    window.__audioPlays = [];
    window.__humanDungeonBanners = [];
    const g = window.lwDebug._g;
    const orig = g.sfx.bind(g);
    g.sfx = (n) => { window.__audioPlays.push(n); return orig(n); };
    const observe = () => {
      const el = document.querySelector('#banner-layer .banner:not(.out) [data-testid="ai-banner-text"]');
      if (!el) return;
      const t = el.textContent || '';
      if (/Keith/i.test(t) && /dungeon|delve/i.test(t)) window.__humanDungeonBanners.push(t);
    };
    new MutationObserver(observe).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

async function loadDungeonStart(page, dungeonList) {
  await page.evaluate(async (list) => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const fam = s.fam_face.find(Boolean);
    if (!fam) throw new Error('no familiar');
    const via = fam.split('/').pop().replace(/\.jpg$/, '');
    s.dungeon_list = list;
    const me = s.players.find((p) => p.name === 'Keith');
    me.mana = 50;
    s.next = 'Keith';
    s.meta.web_pending = { type: 'dungeon', via, draws: 0 };
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
  }, dungeonList);
}

const monster = { deck: 'Dungeon', type: 'Monster', name: 'Orc', monster_type: 'Goblinoid' };
const tre = { deck: 'Dungeon', type: 'Treasure', subtype: 'Gold', gold: 1, text: 'Collect 1 Gold' };
const filler = { deck: 'Dungeon', type: 'Treasure', subtype: 'Gold', gold: 1, text: 'Collect 1 Gold' };

async function enterDungeonViaSettle(page) {
  return page.evaluate(() => window.lwDebug._g.afterAction());
}

async function waitNextAiBanner(page) {
  await expect(page.getByTestId('ai-banner')).toBeVisible({ timeout: 90_000 });
  const text = await page.getByTestId('ai-banner-text').innerText();
  expect(text).not.toMatch(/Keith.*(dungeon|delve)/i);
}

async function sfxFromExitTap(page, startIndex) {
  await waitNextAiBanner(page);
  return page.evaluate((i) => window.__audioPlays.slice(i), startIndex);
}

test('defeat Continue: one door-close until next AI banner; no hit, flip, coin, or human dungeon banner', async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  await spyAudioAndBanners(page);
  await loadDungeonStart(page, [monster, monster, ...Array(18).fill(filler)]);
  const settleDone = enterDungeonViaSettle(page);
  await expect(page.getByTestId('dungeon')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('dungeon-deck').tap();
  await page.waitForTimeout(400);
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-continue')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(400);
  const startIdx = await page.evaluate(() => window.__audioPlays.length);
  await page.getByTestId('dungeon-continue').tap();
  await expect(page.getByTestId('dungeon')).toHaveCount(0, { timeout: 8000 });
  const plays = await sfxFromExitTap(page, startIdx);
  test.info().attach('sfx-exit-window', { body: JSON.stringify(plays), contentType: 'application/json' });
  expect(plays.filter((n) => n === 'door-close')).toHaveLength(1);
  expect(plays.filter((n) => n === 'hit')).toHaveLength(0);
  expect(plays.filter((n) => n === 'flip')).toHaveLength(0);
  expect(plays.filter((n) => n === 'coin')).toHaveLength(0);
  const humanBanners = await page.evaluate(() => window.__humanDungeonBanners);
  expect(humanBanners).toEqual([]);
  await settleDone;
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('success Stop & collect: door-close then one coin; no hit or flip; no human dungeon banner', async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  await spyAudioAndBanners(page);
  await loadDungeonStart(page, [tre, ...Array(20).fill(filler)]);
  const settleDone = enterDungeonViaSettle(page);
  await expect(page.getByTestId('dungeon')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-stop')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(400);
  const startIdx = await page.evaluate(() => window.__audioPlays.length);
  await page.getByTestId('dungeon-stop').tap();
  await expect(page.getByTestId('dungeon-result-panel')).toBeVisible({ timeout: 5000 });
  const plays = await sfxFromExitTap(page, startIdx);
  test.info().attach('sfx-exit-window', { body: JSON.stringify(plays), contentType: 'application/json' });
  expect(plays.filter((n) => n === 'door-close')).toHaveLength(1);
  expect(plays.filter((n) => n === 'coin')).toHaveLength(1);
  expect(plays.filter((n) => n === 'hit')).toHaveLength(0);
  expect(plays.filter((n) => n === 'flip')).toHaveLength(0);
  const dc = plays.indexOf('door-close');
  const coin = plays.indexOf('coin');
  expect(dc).toBeGreaterThanOrEqual(0);
  expect(coin).toBeGreaterThan(dc);
  const humanBanners = await page.evaluate(() => window.__humanDungeonBanners);
  expect(humanBanners).toEqual([]);
  await settleDone;
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});