import { test, expect } from './fixtures.js';
import { boot, view } from './helpers.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function loadFreshG8(page) {
  await page.addInitScript(() => localStorage.setItem('lw.setup.v1', JSON.stringify({
    human_name: 'Keith', player_count: 3,
    ais: [{ name: 'Newt', level: 'normal' }, { name: 'LizWiz', level: 'normal' }],
  })));
  await boot(page);
  await page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const p = s.players.find((q) => q.name === 'Keith');
    p.mana = 50; p.gold = 0; p.wizards = []; p.familiars = []; p.spells = [];
    s.next = 'Keith'; s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result, { fresh: true });
  });
}

async function swipeFromImage(page, image, dx = -140) {
  const box = await image.boundingBox();
  await page.evaluate(({ x, y, dx: delta }) => {
    const target = document.elementFromPoint(x, y);
    const touch = (clientX) => ({ identifier: 71, clientX, clientY: y, screenX: clientX, screenY: y, pageX: clientX, pageY: y, target });
    const dispatch = (type, touches, changedTouches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
      target.dispatchEvent(event);
    };
    const start = touch(x);
    dispatch('touchstart', [start], [start]);
    const move = touch(x + delta * 0.6);
    dispatch('touchmove', [move], [move]);
    const end = touch(x + delta);
    dispatch('touchend', [], [end]);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2, dx });
}

async function swipeFamiliar(page) {
  const v = await view(page);
  const group = v.board.fam_face.filter(Boolean);
  expect(group.length).toBeGreaterThanOrEqual(2);
  const slot = v.board.fam_face.indexOf(group[0]);
  await page.getByTestId(`slot-fam_${slot}`).tap();
  const chooser = page.getByTestId('summon-use');
  await expect(chooser).toBeVisible();
  const track = page.getByTestId('card-track');
  const first = track.locator('[data-testid="expanded-card"][data-index="0"] img');
  const firstSrc = await first.getAttribute('src');
  await swipeFromImage(page, first);
  await expect.poll(() => track.locator('[data-testid="expanded-card"][data-index="1"] img').getAttribute('src')).not.toBe(firstSrc);
  await expect(page.getByTestId('summon-gather')).toBeVisible();
  await page.getByTestId('summon-cancel').tap();
  await expect(chooser).toHaveCount(0);
}

async function swipeSpell(page) {
  const v = await view(page);
  const spells = (v.board.spell_face || []).filter(Boolean);
  const start = spells.findIndex((k, i) => i < spells.length - 1 && v.legal?.research?.[k]);
  expect(start).toBeGreaterThanOrEqual(0);
  await page.getByTestId(`slot-spell_${start}`).tap();
  const expanded = page.getByTestId('expanded');
  const activeIndex = () => expanded.locator('[data-testid="card-indicator"] .dot.active').getAttribute('data-index');
  const image = expanded.locator(`[data-testid="expanded-card"][data-index="${start}"] [data-testid="expanded-img"]`);
  const firstSrc = await image.getAttribute('src');
  const firstIndex = await activeIndex();
  await swipeFromImage(page, image);
  await expect.poll(() => activeIndex()).not.toBe(firstIndex);
  await expect.poll(async () => {
    const idx = await activeIndex();
    return expanded.locator(`[data-testid="expanded-card"][data-index="${idx}"] [data-testid="expanded-img"]`).getAttribute('src');
  }).not.toBe(firstSrc);
  await page.getByTestId('ov-close').tap();
  await expect(expanded).toHaveCount(0);
}

async function openAndCloseBugReport(page) {
  await page.getByTestId('btn-menu').tap();
  await page.getByTestId('menu-bug-report').tap();
  await expect(page.getByTestId('bug-report')).toBeVisible();
  await page.getByTestId('bug-cancel').tap();
  await expect(page.getByTestId('bug-report')).toHaveCount(0);
}

test('shared carousel survives fresh render, Report Bug, restart, and New game', async ({ page }) => {
  await loadFreshG8(page);
  await swipeFamiliar(page);
  await swipeSpell(page);

  await openAndCloseBugReport(page);
  await swipeFamiliar(page);

  await page.getByTestId('btn-menu').tap();
  await page.getByTestId('menu-restart').tap();
  await page.waitForFunction(() => window.lwDebug.view().round === 2);
  await swipeFamiliar(page);
  await swipeSpell(page);

  await page.getByTestId('btn-menu').tap();
  await page.getByTestId('menu-new-game').tap();
  await expect(page.getByTestId('game-setup')).toBeVisible();
  await page.getByTestId('setup-quick-start').tap();
  await expect(page.getByTestId('new-game-hand')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('pick-Eye_of_Newt').tap();
  await page.getByTestId('pick-Horn').tap();
  await page.getByTestId('new-game-start').tap();
  await page.waitForFunction(() => window.lwDebug.view().round === 1);
  await swipeFamiliar(page);
  await swipeSpell(page);
});
