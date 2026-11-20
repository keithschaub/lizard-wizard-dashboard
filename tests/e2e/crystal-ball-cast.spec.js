import fs from 'fs';
import { test, expect } from './fixtures.js';

// Crystal Ball cast animation: Keith's round 23 save (issue-123-research: 40 mana, 7 Eye of Newt) with Crystal Ball
// face up. Research & Cast shows the crystal ball over the board for about 1.6 s; it never takes taps or changes the hand.
test.use({ viewport: { width: 430, height: 775 } });

test('Crystal Ball: the ball shows over the board, ignores taps, clears within 2.5 s; the hand holds 5 cards', async ({ page }) => {
  const s = JSON.parse(fs.readFileSync('tests/e2e/fixtures/issue-123-research.json', 'utf8'));
  s.spell_face[0] = '/workspace/lizard-wizard/assets/Spell_Crystal_Ball.jpg';
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((t) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1');
  }, JSON.stringify(s));
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug);
  await page.evaluate(() => { window.lwDebug._g.aiStep = async () => false; });
  await page.waitForFunction(() => window.lwDebug.ready(), null, { timeout: 60_000 });

  // Times the overlay in the page, from insertion to removal, so a slow runner's own steps are not counted.
  await page.evaluate(() => {
    const W = window.__cb = {};
    new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) if (n.dataset?.testid === 'crystal-ball-cast') W.added = performance.now();
        for (const n of r.removedNodes) if (n.dataset?.testid === 'crystal-ball-cast') W.removed = performance.now();
      }
    }).observe(document.body, { childList: true });
  });
  await page.locator('#board [data-slot="spell_0"]').first().tap();
  await page.getByTestId('research-cast').tap();
  const ball = page.getByTestId('crystal-ball-cast');
  await expect(ball).toBeAttached({ timeout: 10_000 });

  const probe = await page.evaluate(() => {
    const el = document.querySelector('[data-testid=crystal-ball-cast]');
    const r = el.querySelector('.cb-ball').getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const stage = document.getElementById('stage').getBoundingClientRect();
    return { pe: getComputedStyle(el).pointerEvents, through: !el.contains(top), text: el.innerText.trim(),
      centred: Math.abs(r.left + r.width / 2 - (stage.left + stage.width / 2)) < 2 && r.top > stage.top && r.bottom < stage.bottom };
  });
  expect(probe).toEqual({ pe: 'none', through: true, text: '', centred: true });
  // A tap on the ball lands on the board underneath: the empty board opens the players sheet.
  await page.mouse.click(215, 300);
  await expect(page.getByTestId('mats')).toBeVisible();
  await page.getByTestId('mats').getByTestId('ov-close').click();

  await expect(ball).toHaveCount(0, { timeout: 2_500 });
  const life = await page.evaluate(() => window.__cb.removed - window.__cb.added);
  expect(life, 'on screen for').toBeLessThan(2_500);
  await expect(page.locator('#dock [data-testid^=hand-]')).toHaveCount(5);
  const me = await page.evaluate(() => window.lwDebug.view().players.find((p) => p.you));
  expect(me.hand).toHaveLength(5);
  expect(me.spells.find((x) => x.key === 'Spell_Crystal_Ball')?.cast).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});
