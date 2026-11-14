import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// Issues #122 and #127. fixtures/issue-127-after-two-losses.json: Keith's save at round 17 just after Keith won both
// of Newt's auctions (Reptilius at 18, Draco at 27): Keith 6 mana, Newt 34, Newt still to act. Newt keeps its turn
// (a starter who loses acts again, with no cap) and opens Bufonem Creaturae at exactly Keith's tracked 6 mana, which
// Keith cannot top; Keith can only pass, Newt wins, and only then is it Keith's turn.
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-127-after-two-losses.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

test('after two lost auctions the AI keeps its turn and recruits at exactly the rival mana (issues #122, #127)', async ({ page }) => {
  await page.addInitScript(() => {
    window.__banners = [];
    new MutationObserver(() => {
      const el = document.querySelector('#banner-layer .banner:not(.out)');
      if (!el) return;
      const k = el.innerText.replace(/\s+/g, ' ');
      if (window.__banners[window.__banners.length - 1] !== k) window.__banners.push(k);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), SAVE);
  await boot(page);

  const arena = page.getByTestId('arena');
  await expect(arena).toBeVisible({ timeout: 30_000 });
  const a = await page.evaluate(() => window.lwDebug.view().auction);
  expect(a.starter).toBe('Newt');
  expect(a.card).toContain('Bufonem_Creaturae');
  expect(a.high).toBe(6);
  await expect(arena).toContainText('you cannot beat 6');
  await expect(page.getByTestId('bid-go')).toHaveCount(0);
  await page.getByTestId('bid-pass').click();

  await expect(page.getByTestId('dock-status')).toContainText('Your move', { timeout: 60_000 });
  const log = await page.evaluate(() => window.lwDebug.log());
  const r17 = log.filter((e) => e.r === 17 && e.act === 'auction');
  expect(r17.map((e) => e.who)).toEqual(['13InchesOfFun', '13InchesOfFun', 'Newt']);
  const raw = await page.evaluate(async () => JSON.parse((await window.lwDebug._g.call('dump')).result).meta.log.filter((e) => e.r === 17 && e.act === 'auction'));
  expect(raw.at(-1)).toMatchObject({ won: 'Newt', starter: 'Newt', price: 6 });
  const v = await page.evaluate(() => window.lwDebug.view());
  expect(v.players.find((p) => p.you).mana).toBe(6);
  expect(v.next).toBe('13InchesOfFun');
});
