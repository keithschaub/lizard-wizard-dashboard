import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// Issue #122. fixtures/issue-122-second-auction.json: Keith's round 18 save (13InchesOfFun vs Newt, master), made
// Newt's turn with 40 mana for Keith. Newt has opened an auction and lost it to Keith, opened a second one, and that
// second auction now waits for Keith's bid. Outbidding it must leave Newt its turn: it takes another (non-auction)
// action, shown as Newt's move, and only then does the turn pass to Keith.
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-122-second-auction.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

test('an AI that loses its second auction still takes its turn (issue #122)', async ({ page }) => {
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
  const lost = await page.evaluate(() => window.lwDebug.log().then((l) => l.filter((e) => e.act === 'auction' && e.r === 18).length));
  expect(lost).toBe(1);

  await expect(page.getByTestId('bid-go')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('bid-go').click();
  // The arena shows the auction result first, then Newt's follow-up move plays as a banner.
  await expect.poll(() => page.evaluate(() => window.__banners.some((x) => /NEWT'S TURN/i.test(x))), { timeout: 60_000 }).toBe(true);
  await expect(page.getByTestId('dock-status')).toContainText('Your move', { timeout: 60_000 });

  const banners = await page.evaluate(() => window.__banners);
  const newtMove = banners.find((b) => /NEWT'S TURN/i.test(b));
  expect(newtMove, `Newt's follow-up move is announced as Newt's turn: ${JSON.stringify(banners)}`).toBeTruthy();
  expect(newtMove).toMatch(/Newt (gathered|sold|built|researched|summoned|cast)/);
  expect(banners.some((b) => /13INCHESOFFUN'S TURN/i.test(b) && /Newt /.test(b))).toBe(false);

  const tail = await page.evaluate(() => window.lwDebug.log().then((l) => l.filter((e) => e.act !== 'turn' && e.act !== 'achievement' && e.r >= 18)
    .map((e) => `${e.act}:${e.who}`)));
  const i = tail.indexOf('auction:13InchesOfFun');
  expect(tail.slice(i, i + 3)).toEqual(['auction:13InchesOfFun', 'auction:13InchesOfFun', expect.stringMatching(/^(gather|convert|convert1|build|research|summon|cast):Newt$/)]);
  expect(await page.evaluate(() => window.lwDebug.view().next)).toBe('13InchesOfFun');
});
