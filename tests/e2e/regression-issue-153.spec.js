import fs from 'fs';
import { test, expect } from './fixtures.js';
import { tapEmptyBoard } from './helpers.js';

// Issue 153: on the players inventory, tapping any card opens the shared enlarged view, which cycles through that
// player's whole inventory. Keith's round 19 save from the report (2026-11-21T01-07-48-707Z-iddwd), opened both from
// the board (players sheet) and with the eye.
const SAVE = fs.readFileSync('tests/regression/fixtures/issue-153.json', 'utf8');
test.use({ viewport: { width: 430, height: 775 } });

async function open(page) {
  await page.addInitScript((t) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1');
  }, SAVE);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug);
  await page.evaluate(() => { window.lwDebug._g.aiStep = async () => false; });
  await page.waitForFunction(() => window.lwDebug.ready(), null, { timeout: 60_000 });
}

// The same finger swipe the spell and familiar carousels are tested with: touch events on the card image.
async function swipeLeft(page, image) {
  const box = await image.boundingBox();
  await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    const touch = (clientX) => ({ identifier: 71, clientX, clientY: y, screenX: clientX, screenY: y, pageX: clientX, pageY: y, target });
    const dispatch = (type, touches, changed) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(ev, { touches: { value: touches }, changedTouches: { value: changed } });
      target.dispatchEvent(ev);
    };
    dispatch('touchstart', [touch(x)], [touch(x)]);
    dispatch('touchmove', [touch(x - 84)], [touch(x - 84)]);
    dispatch('touchend', [], [touch(x - 140)]);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

// Index and card key the enlarged view is showing.
const showing = (big) => big.evaluate((el) => {
  const dot = el.querySelector('[data-testid=card-indicator] .dot.active');
  const counter = el.querySelector('[data-testid=card-indicator] .counter');
  const i = dot ? Number(dot.dataset.index) : Number(counter.textContent.split('/')[0]) - 1;
  const total = dot ? el.querySelectorAll('[data-testid=card-indicator] .dot').length : Number(counter.textContent.split('/')[1]);
  return { i, total, key: el.querySelector(`[data-testid=expanded-card][data-index="${i}"] img`)?.getAttribute('alt') };
});

for (const route of ['players sheet', 'eye']) {
  test(`issue 153 (${route}): a tapped card enlarges and swipes through that player's inventory`, async ({ page }) => {
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    let sheet; let mat;
    if (route === 'eye') {
      await page.getByTestId('eye-toggle').tap();
      sheet = page.getByTestId('inventory'); mat = (n) => sheet.getByTestId(`mat-inv-${n}`);
    } else {
      await tapEmptyBoard(page);
      sheet = page.getByTestId('mats'); mat = (n) => sheet.getByTestId(`mat-${n}`);
    }
    await expect(sheet).toBeVisible();
    const big = page.locator('[data-testid=expanded]:not(.out)');
    const me = await page.evaluate(() => window.lwDebug.view().players.find((p) => p.you));
    // The cards in the order the mat shows them (hand, wizard and tower pairs, spells, familiars, items).
    const order = (name) => mat(name).locator('.mcard:not(.empty):not(.back) img').evaluateAll((im) => im.map((x) => x.getAttribute('alt')));
    const mine = await order(me.name);
    expect(mine).toEqual([...me.hand, ...me.spells.map((s) => s.key), ...me.familiars]);

    // A spell in the middle of the list: the view covers every card on this mat, in order.
    const spell = mat(me.name).locator('.mcard img[alt="Spell_Transmute"]');
    await spell.scrollIntoViewIfNeeded();
    await spell.tap();
    await expect(big).toBeVisible();
    let at = await showing(big);
    expect(at).toEqual({ i: mine.indexOf('Spell_Transmute'), total: mine.length, key: 'Spell_Transmute' });

    // Swipe to the next card, then the arrow to the one after.
    await swipeLeft(page, big.locator(`[data-testid=expanded-card][data-index="${at.i}"] img`));
    await expect.poll(async () => (await showing(big)).i).toBe(at.i + 1);
    at = await showing(big);
    expect(at.key).toBe(mine[at.i]);
    await big.getByTestId('nav-next').click();
    await expect.poll(async () => (await showing(big)).key).toBe(mine[at.i + 1]);

    // Close: back on the inventory, nothing else open.
    await big.getByTestId('ov-close').tap();
    await expect(big).toHaveCount(0);
    await expect(sheet).toBeVisible();

    // The other player's cards enlarge too: a tower, then on to the next of that player's cards.
    const rival = await page.evaluate(() => window.lwDebug.view().players.find((p) => !p.you));
    const theirs = await order(rival.name);
    expect([...theirs].sort()).toEqual([...rival.wizards, ...rival.towers, ...rival.spells.map((s) => s.key), ...rival.familiars, ...rival.treasures.map((x) => x.key)].sort());
    const tower = mat(rival.name).locator(`.mcard img[alt="${rival.towers[0]}"]`).first();
    await tower.scrollIntoViewIfNeeded();
    await tower.tap();
    await expect(big).toBeVisible();
    at = await showing(big);
    expect(at.total).toBe(theirs.length);
    expect(at.key).toBe(rival.towers[0]);
    expect(at.i).toBe(theirs.indexOf(rival.towers[0]));
    await big.getByTestId('nav-next').click();
    await expect.poll(async () => (await showing(big)).key).toBe(theirs[at.i + 1]);
    await big.getByTestId('ov-close').tap();
    await expect(big).toHaveCount(0);
    await expect(sheet).toBeVisible();
    if (route === 'eye') expect(await page.evaluate(() => document.querySelectorAll('#overlays .overlay').length)).toBe(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
