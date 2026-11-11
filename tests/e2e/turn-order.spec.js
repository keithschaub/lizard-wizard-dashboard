import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// Cause before effect: banners and the Chronicle show an action before anything it caused.
// summon-achievement / summon-cast-achievement: Keith's round 16 save, Newt (AI) to move: summons Nympharum,
// gathers 5 Toadstool (x7 achievement), and in the second save also casts Bloom.
// mana-fountain / spell-shield / reshuffle: the same save after a real engine action by Newt (build next to
// Keith's Mana Fountain, Flame Bolt into Keith's Spell Shield, gather that empties the reagent deck); the
// turn's entries are replayed through the AI banner path. meta._scenario_n0 is where that turn's log starts.
const fixture = (name) => fs.readFileSync(`tests/e2e/fixtures/turn-order-${name}.json`, 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

async function recordBanners(page) {
  await page.addInitScript(() => {
    window.__banners = [];
    new MutationObserver(() => {
      const el = document.querySelector('#banner-layer .banner:not(.out)');
      if (!el) return;
      const k = `${el.dataset.move}|${el.innerText.replace(/\s+/g, ' ')}`;
      if (window.__banners[window.__banners.length - 1] !== k) window.__banners.push(k);
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

async function load(page, save) {
  await recordBanners(page);
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), save);
  await boot(page);
}

async function replayTurn(page, save) {
  const n0 = JSON.parse(save).meta._scenario_n0;
  await page.evaluate(async (n0) => {
    const g = window.lwDebug._g;
    const all = (await g.call('full_log')).result.filter((e) => e.i >= n0 && e.act !== 'turn' && e.act !== 'reshuffle_reagents');
    g.aiRunning = true;
    await g.showMoves(all, 'Newt');
    await window.ui.bannerDone(g);
    g.aiRunning = false;
  }, n0);
}

const newtBanners = async (page) => [...new Set((await page.evaluate(() => window.__banners)).filter((x) => /newt's turn/i.test(x)))];

async function chronicleTail(page, n) {
  await page.evaluate(() => window.ui.openLog(window.lwDebug._g));
  await expect(page.getByTestId('log-item').last()).toBeVisible();
  return page.evaluate((n) => [...document.querySelectorAll('[data-testid=log-item]')].slice(-n).map((x) => x.innerText.replace(/\s+/g, ' ')), n);
}

const moves = (list) => [...new Map(list.map((b) => [b.split('|')[0], b])).values()];

test('summon comes before the achievement it earned', async ({ page }) => {
  await load(page, fixture('summon-achievement'));
  await expect.poll(async () => moves(await newtBanners(page)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  const [m1, m2] = moves(await newtBanners(page));
  expect(m1).toMatch(/^1\/2\|.*Newt summoned.*Nympharum.*15.*gathered.*×5/i);
  expect(m2).toMatch(/^2\/2\|.*Newt claimed an achievement.*×7.*for 10 VP/i);
  const log = await chronicleTail(page, 4);
  const s = log.findIndex((t) => t.startsWith('Newt summoned Nympharum'));
  expect(s).toBeGreaterThanOrEqual(0);
  expect(log[s + 1]).toMatch(/^Newt claimed an achievement ×7 for 10 VP/);
});

test('familiar cast folds into the summon banner, then the achievement', async ({ page }) => {
  await load(page, fixture('summon-cast-achievement'));
  await expect.poll(async () => moves(await newtBanners(page)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  const all = moves(await newtBanners(page));
  expect(all).toHaveLength(2);
  expect(all[0]).toMatch(/^1\/2\|.*Newt summoned.*gathered.*×5.*and cast Bloom paying.*×3.*\+1 any Reagent when Gathering/i);
  expect(all[1]).toMatch(/^2\/2\|.*Newt claimed an achievement/i);
  expect(all.some((b) => /Newt cast Bloom/i.test(b))).toBe(false);
  const log = await chronicleTail(page, 4);
  const s = log.findIndex((t) => t.startsWith('Newt summoned Nympharum'));
  expect(log[s]).toMatch(/gathered ×5 and cast Bloom Druidry paying ×3/);
  expect(log[s + 1]).toMatch(/^Newt claimed an achievement/);
  const summon = page.getByTestId('log-item').filter({ hasText: 'Newt summoned Nympharum' }).last();
  await expect(summon.getByTestId('log-cast')).toHaveCount(1);
  await expect(summon.locator('.thumbs img')).toHaveAttribute('alt', 'Familiar_15_Nympharum');
});

test("another seat's Mana Fountain bonus is a sub-line of the build, under the builder's turn", async ({ page }) => {
  const save = fixture('mana-fountain');
  await load(page, save);
  await replayTurn(page, save);
  const all = await page.evaluate(() => window.__banners);
  expect(all.some((b) => /KEITH'S TURN|Keith's turn/i.test(b))).toBe(false);
  const built = all.filter((b) => /Newt built/.test(b));
  expect(built.length).toBeGreaterThan(0);
  expect(built[0]).toMatch(/^1\/1\|N NEWT'S TURN Newt built Obsidian Fortress T2 Necromancy ×2 Keith gets 5 from Mana Fountain/i);
  const log = await chronicleTail(page, 1);
  expect(log[0]).toMatch(/^Newt built Obsidian Fortress T2 Necromancy paying ×2 Keith gets 5 from Mana Fountain/);
});

test('a Spell Shield block is one line after the cast', async ({ page }) => {
  const save = fixture('spell-shield');
  await load(page, save);
  await replayTurn(page, save);
  const all = moves(await newtBanners(page));
  expect(all).toHaveLength(2);
  expect(all[0]).toMatch(/^1\/2\|.*Newt cast Flame Bolt Druidry/);
  expect(all[1]).toMatch(/^2\/2\|N NEWT'S TURN · MOVE 2 OF 2 Keith's Spell Shield blocked Newt's Flame Bolt and is used up/i);
  const log = await chronicleTail(page, 2);
  expect(log[0]).toMatch(/^Newt cast Flame Bolt/);
  expect(log[1]).toBe("Keith's Spell Shield blocked Newt's Flame Bolt and is used up");
  await expect(page.getByTestId('log-item').last().locator('.thumbs img')).toHaveAttribute('alt', 'Spell_Spell_Shield_T');
});

test('the reshuffle comes after the gather that emptied the deck', async ({ page }) => {
  const save = fixture('reshuffle');
  await load(page, save);
  const log = await chronicleTail(page, 2);
  expect(log[0]).toMatch(/^Newt gathered/);
  expect(log[1]).toMatch(/^Reagent deck reshuffled from the discard pile/);
});
