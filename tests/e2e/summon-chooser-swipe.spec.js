import { test, expect } from './fixtures.js';
import { boot, view } from './helpers.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function seed(page) {
  await boot(page);
  return page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const p = s.players.find((q) => q.name === 'Keith');
    p.mana = 50; p.gold = 0; p.wizards = []; p.familiars = []; p.spells = [];
    s.next = 'Keith'; s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    return r.result;
  });
}

test('Summon chooser closes without state change and swipes market familiars', async ({ page }) => {
  const v = await seed(page);
  const group = v.board.fam_face.filter(Boolean);
  const first = group[0];
  await page.getByTestId(`slot-fam_${v.board.fam_face.indexOf(first)}`).tap();
  const chooser = page.getByTestId('summon-use');
  await expect(chooser).toBeVisible();
  await expect(page.getByTestId('summon-cancel')).toBeVisible();
  await chooser.screenshot({ path: 'docs/screenshots/summon-chooser-close-swipe-dpr3.png' });
  const before = await view(page);
  await page.getByTestId('summon-cancel').tap();
  await expect(chooser).toHaveCount(0);
  const afterCancel = await view(page);
  expect(afterCancel.players.find((p) => p.you).mana).toBe(before.players.find((p) => p.you).mana);
  expect(afterCancel.players.find((p) => p.you).familiars).toEqual(before.players.find((p) => p.you).familiars);

  await page.getByTestId(`slot-fam_${v.board.fam_face.indexOf(first)}`).tap();
  const track = page.getByTestId('familiar-action-card-track');
  const firstSrc = await track.locator('img').getAttribute('src');
  const firstDetail = await page.getByTestId('summon-gather').textContent();
  await track.dispatchEvent('touchstart', { touches: [{ identifier: 7, clientX: 320, clientY: 300 }], changedTouches: [{ identifier: 7, clientX: 320, clientY: 300 }] });
  await track.dispatchEvent('touchmove', { touches: [{ identifier: 7, clientX: 240, clientY: 300 }] });
  await track.dispatchEvent('touchend', { changedTouches: [{ identifier: 7, clientX: 180, clientY: 300 }] });
  await expect.poll(() => track.locator('img').getAttribute('src')).not.toBe(firstSrc);
  await expect.poll(() => page.getByTestId('summon-gather').textContent()).not.toBe(firstDetail);
  await chooser.screenshot({ path: 'docs/screenshots/summon-chooser-close-swipe-after-dpr3.png' });

  expect(await track.locator('img').getAttribute('src')).toBe(`art/cards/${group[1]}.webp`);
  const secondDetail = await page.getByTestId('summon-gather').textContent();
  await track.dispatchEvent('touchstart', { touches: [{ identifier: 8, clientX: 180, clientY: 300 }], changedTouches: [{ identifier: 8, clientX: 180, clientY: 300 }] });
  await track.dispatchEvent('touchmove', { touches: [{ identifier: 8, clientX: 260, clientY: 300 }] });
  await track.dispatchEvent('touchend', { changedTouches: [{ identifier: 8, clientX: 320, clientY: 300 }] });
  await expect.poll(() => track.locator('img').getAttribute('src')).toBe(firstSrc);
  await expect.poll(() => page.getByTestId('summon-gather').textContent()).not.toBe(secondDetail);
  await track.dispatchEvent('touchstart', { touches: [{ identifier: 9, clientX: 320, clientY: 300 }], changedTouches: [{ identifier: 9, clientX: 320, clientY: 300 }] });
  await track.dispatchEvent('touchmove', { touches: [{ identifier: 9, clientX: 240, clientY: 300 }] });
  await track.dispatchEvent('touchend', { changedTouches: [{ identifier: 9, clientX: 180, clientY: 300 }] });
  await expect.poll(() => track.locator('img').getAttribute('src')).toBe(`art/cards/${group[1]}.webp`);
  await page.getByTestId('summon-score').tap();
  await expect.poll(async () => (await view(page)).players.find((p) => p.you).familiars).toContain(group[1]);
  await expect.poll(async () => (await view(page)).players.find((p) => p.you).mana).toBe(45);
});
