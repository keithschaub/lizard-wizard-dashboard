// Dungeon exit: move-summary banner plays door-close once (not the card-flip sound).
import { test, expect } from './fixtures.js';
import { boot, watchErrors } from './helpers.js';

test.use({ viewport: { width: 430, height: 775 } });

async function spyAudio(page) {
  await page.evaluate(() => {
    window.__audioPlays = [];
    const g = window.lwDebug._g;
    const orig = g.sfx.bind(g);
    g.sfx = (n) => { window.__audioPlays.push(n); return orig(n); };
  });
}

async function seedDefeatedDungeon(page) {
  await spyAudio(page);
  await page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const fam = s.fam_face.find(Boolean);
    const via = fam.split('/').pop().replace(/\.jpg$/, '');
    const monster = { deck: 'Dungeon', type: 'Monster', name: 'Orc', monster_type: 'Goblinoid' };
    const filler = { deck: 'Dungeon', type: 'Treasure', subtype: 'Gold', gold: 1, text: 'Collect 1 Gold' };
    s.dungeon_list = [monster, monster, ...Array(18).fill(filler)];
    const me = s.players.find((p) => p.name === 'Keith');
    me.mana = 50;
    s.next = 'Keith';
    s.meta.web_pending = { type: 'dungeon', via, draws: 0 };
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    window.lwDebug._g.aiStep = async () => false;
    window.__dungeonFlowDone = window.ui.dungeonFlow(window.lwDebug._g);
  });
}

test('Continue after dungeon plays door-close once, not flip', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  await seedDefeatedDungeon(page);
  await expect(page.getByTestId('dungeon')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('dungeon-entry-doors')).toHaveCount(0, { timeout: 8000 });
  await page.getByTestId('dungeon-deck').tap();
  await page.waitForTimeout(350);
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-continue')).toBeVisible({ timeout: 5000 });

  const beforeContinue = await page.evaluate(() => window.__audioPlays.length);
  await page.getByTestId('dungeon-continue').tap();
  await expect(page.getByTestId('dungeon')).toHaveCount(0, { timeout: 8000 });
  const queued = await page.evaluate(async () => {
    const g = window.lwDebug._g;
    const n = g.moveQueue.length;
    if (n) await g.playMoves(g.moveQueue.splice(0));
    await window.ui.bannerDone(g);
    return n;
  });
  expect(queued).toBeGreaterThan(0);

  const afterContinue = await page.evaluate((b) => window.__audioPlays.slice(b), beforeContinue);
  expect(afterContinue.filter((n) => n === 'door-close')).toHaveLength(1);
  expect(afterContinue.filter((n) => n === 'flip')).toHaveLength(0);
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});