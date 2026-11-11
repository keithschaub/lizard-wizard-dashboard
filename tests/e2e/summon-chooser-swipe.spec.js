import { test, expect } from './fixtures.js';
import { boot, view } from './helpers.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function seed(page, next = 'Keith') {
  await boot(page);
  return page.evaluate(async (nextSeat) => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const p = s.players.find((q) => q.name === 'Keith');
    p.mana = 50; p.gold = 0; p.wizards = []; p.familiars = []; p.spells = [];
    s.next = nextSeat; s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    return r.result;
  }, next);
}

async function swipeFromImage(page, image, dx) {
  const box = await image.boundingBox();
  await page.evaluate(({ x, y, dx: delta }) => {
    const target = document.elementFromPoint(x, y);
    const touch = (clientX) => ({ identifier: 41, clientX, clientY: y, screenX: clientX, screenY: y, pageX: clientX, pageY: y, target });
    const send = (type, touches, changedTouches) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(e, { touches: { value: touches }, changedTouches: { value: changedTouches } });
      target.dispatchEvent(e);
    };
    const start = touch(x); send('touchstart', [start], [start]);
    const move = touch(x + delta * .55); send('touchmove', [move], [move]);
    const end = touch(x + delta); send('touchend', [], [end]);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2, dx });
}

test('Summon chooser closes without state change and swipes market familiars', async ({ page }) => {
  const v = await seed(page);
  const group = v.board.fam_face.filter(Boolean);
  const first = group[0];
  await page.getByTestId(`slot-fam_${v.board.fam_face.indexOf(first)}`).tap();
  const chooser = page.getByTestId('summon-use');
  await expect(chooser).toBeVisible();
  await expect(page.getByTestId('summon-cancel')).toBeVisible();
  await chooser.screenshot({ path: 'docs/screenshots/summon-expand-card-iphone.png' });
  const before = await view(page);
  await page.getByTestId('summon-cancel').tap();
  await expect(chooser).toHaveCount(0);
  const afterCancel = await view(page);
  expect(afterCancel.players.find((p) => p.you).mana).toBe(before.players.find((p) => p.you).mana);
  expect(afterCancel.players.find((p) => p.you).familiars).toEqual(before.players.find((p) => p.you).familiars);

  await page.getByTestId(`slot-fam_${v.board.fam_face.indexOf(first)}`).tap();
  const track = page.getByTestId('card-track');
  const tileGrid = page.getByTestId('expanded-actions');
  const cost = page.getByTestId('summon-cost');
  await expect(cost.locator('.log-value-number').first()).toHaveText(String(v.legal.summon[first].cost));
  await expect(cost).toContainText('You have');
  await expect(page.locator('.familiar-action-subtitle')).toHaveCount(0);
  await expect(page.locator('.familiar-action-pick')).toHaveText('THEN PICK ONE');
  await expect(page.locator('.expand.tiles .cardinfo')).toHaveCount(0);
  expect(await chooser.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/rgba?\(/);
  expect(await page.locator('.familiar-action-detail').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  const tileLayout = await tileGrid.evaluate((el) => {
    const buttons = [...el.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
    const styles = getComputedStyle(el);
    return {
      columns: styles.gridTemplateColumns.split(' ').filter(Boolean).length,
      rows: buttons.map((b) => Math.round(b.top)),
      inViewport: buttons.length === 4 && buttons.every((b) => b.top >= 0 && b.bottom <= innerHeight),
    };
  });
  expect(tileLayout.columns).toBe(2);
  expect(tileLayout.inViewport).toBe(true);
  expect(tileLayout.rows[0]).toBe(tileLayout.rows[1]);
  expect(tileLayout.rows[2]).toBe(tileLayout.rows[3]);
  const firstImage = track.locator('[data-testid="expanded-card"][data-index="0"] img');
  const firstSrc = await firstImage.getAttribute('src');
  const firstDetail = await page.getByTestId('summon-gather').textContent();
  await swipeFromImage(page, firstImage, -140);
  const secondImage = track.locator('[data-testid="expanded-card"][data-index="1"] img');
  await expect.poll(() => secondImage.getAttribute('src')).not.toBe(firstSrc);
  await expect.poll(() => page.getByTestId('summon-gather').textContent()).not.toBe(firstDetail);
  await chooser.screenshot({ path: 'docs/screenshots/summon-expand-card-iphone-after-swipe.png' });

  expect(await secondImage.getAttribute('src')).toBe(`art/cards/${group[1]}.webp`);
  const secondDetail = await page.getByTestId('summon-gather').textContent();
  await expect(cost.locator('.log-value-number').first()).toHaveText(String(v.legal.summon[group[1]].cost));
  await expect(page.getByTestId('summon-dungeon')).toContainText('draw for treasure');
  await swipeFromImage(page, secondImage, 140);
  await expect.poll(() => firstImage.getAttribute('src')).toBe(firstSrc);
  await expect.poll(() => page.getByTestId('summon-gather').textContent()).not.toBe(secondDetail);
  await swipeFromImage(page, firstImage, -140);
  await expect.poll(() => secondImage.getAttribute('src')).toBe(`art/cards/${group[1]}.webp`);
  await page.getByTestId('summon-score').tap();
  await expect.poll(async () => (await view(page)).players.find((p) => p.you).familiars).toContain(group[1]);
  await expect.poll(async () => (await view(page)).players.find((p) => p.you).mana).toBe(45);
});

test('market familiar expand uses the same iOS carousel', async ({ page }) => {
  const v = await seed(page, 'Newt');
  const group = v.board.fam_face.filter(Boolean);
  await page.getByTestId(`slot-fam_${v.board.fam_face.indexOf(group[0])}`).tap();
  const expanded = page.getByTestId('expanded');
  await expect(expanded).toBeVisible();
  const first = expanded.locator('[data-testid=expanded-img]').first();
  const firstSrc = await first.getAttribute('src');
  await swipeFromImage(page, first, -140);
  await expect.poll(async () => {
    const active = expanded.locator('[data-testid=card-indicator] .dot.active').getAttribute('data-index');
    return expanded.locator(`[data-testid=expanded-card][data-index="${await active}"] [data-testid=expanded-img]`).getAttribute('src');
  }).not.toBe(firstSrc);
});

test.describe('approved chooser layout at 430px', () => {
  test.use({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 });

  test('cost, prompt, backdrop, arrows, and tiles fit the iPhone viewport', async ({ page }) => {
    const v = await seed(page);
    const first = v.board.fam_face.find(Boolean);
    await page.getByTestId(`slot-fam_${v.board.fam_face.indexOf(first)}`).tap();
    const chooser = page.getByTestId('summon-use');
    await expect(chooser).toBeVisible();
    await expect(page.getByTestId('summon-cost').locator('.log-value-number').first()).toHaveText(String(v.legal.summon[first].cost));
    await expect(page.locator('.familiar-action-pick')).toHaveText('THEN PICK ONE');
    const layout = await chooser.evaluate((el) => {
      const card = el.querySelector('[data-testid="card-track"]').getBoundingClientRect();
      const buttons = [...el.querySelectorAll('.familiar-action-tile')].map((b) => b.getBoundingClientRect());
      const bg = getComputedStyle(el).backgroundColor;
      return {
        cardTop: card.top,
        cardBottom: card.bottom,
        tileColumns: getComputedStyle(el.querySelector('.familiar-action-grid')).gridTemplateColumns.split(' ').length,
        tilesFit: buttons.every((b) => b.bottom <= innerHeight),
        darkBackdrop: bg === 'rgb(7, 10, 24)',
      };
    });
    expect(layout.cardTop).toBeGreaterThan(0);
    expect(layout.cardBottom).toBeLessThan(600);
    expect(layout.tileColumns).toBe(2);
    expect(layout.tilesFit).toBe(true);
    expect(layout.darkBackdrop).toBe(true);
    await expect(page.getByTestId('nav-prev')).toBeVisible();
    await expect(page.getByTestId('nav-next')).toBeVisible();
    await chooser.screenshot({ path: 'docs/screenshots/summon-chooser-430.png' });
  });
});
