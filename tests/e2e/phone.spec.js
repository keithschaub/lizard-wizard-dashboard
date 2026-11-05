// Phone layout + playtest fixes (Keith's iPhone playtest): pickers, card detail and mats never clip under the status bar
// or Safari's bottom bar; the end of the game keeps the scores and offers a new game; branding; GoatCounter.
// iPhone safe areas and Safari's floating toolbar are simulated with the CSS variables the layout uses.
import { test, expect } from './fixtures.js';
import fs from 'fs';
import { watchErrors, view, shot, me } from './helpers.js';

const INSET = { top: 47, bottom: 34, chrome: 84 };
const G8 = JSON.parse(fs.readFileSync('engine/game/g8_state.json', 'utf8'));
const P = (s, n) => s.players.find((p) => p.name === n);
const ACH_FILE = 'engine/cards/cards.json';                 // the achievement pool scripts/deal4.py draws 4 tiles from

async function open(page, mutate = null) {
  if (mutate) {
    const s = structuredClone(G8); mutate(s);
    await page.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(s));
  }
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await page.addStyleTag({ content: `:root { --safe-t: ${INSET.top}px !important; --safe-b: ${INSET.bottom}px !important; --chrome-b: ${INSET.chrome}px !important; }` });
}

const limits = (page) => page.evaluate(({ top, bottom, chrome }) => ({ top, bottom: window.innerHeight - bottom - chrome, h: window.innerHeight }), INSET);
const box = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
async function scrollOverlay(page, testid, to) {
  await page.getByTestId(testid).evaluate((el, t) => { el.scrollTop = t === 'bottom' ? el.scrollHeight : 0; }, to);
  await page.waitForTimeout(250);
}

test('Scribe picker: all 5 spell cards reachable above the browser bar; picking the 5th works', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, (s) => { P(s, 'Keith').tok = ['Eye_of_Newt', 'Eye_of_Newt', 'Mandrake', 'Horn']; });
  const sk = (await view(page)).board.spell_face.indexOf('Spell_Scribe');
  await page.getByTestId(`slot-spell_${sk}`).tap();
  await page.getByTestId('research-cast').tap();
  const cards = page.locator('[data-testid^=scry-]');
  await expect(cards).toHaveCount(5);
  await page.waitForTimeout(600);
  await shot(page, '09-scribe-picker');
  await scrollOverlay(page, 'effect', 'bottom');
  const L = await limits(page);
  const fifth = await box(cards.nth(4));
  expect(fifth.bottom, `5th card bottom ${fifth.bottom} must clear the bottom bar at ${L.bottom}`).toBeLessThanOrEqual(L.bottom);
  expect(fifth.top).toBeGreaterThanOrEqual(L.top);
  const key = (await cards.nth(4).getAttribute('data-testid')).slice(5);
  await cards.nth(4).tap();
  await expect(page.getByTestId('effect')).toHaveCount(0);
  await expect.poll(async () => me(await view(page)).spells.find((x) => x.key === key)?.cast).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('card detail: the whole card is visible under the status bar; close button never covers it', async ({ page }) => {
  await open(page);
  await page.getByTestId('slot-tower_face').tap();
  const ov = page.getByTestId('expanded');
  await expect(ov).toBeVisible();
  await page.waitForTimeout(500);
  await scrollOverlay(page, 'expanded', 'top');
  const L = await limits(page);
  const img = await box(page.getByTestId('expanded-img'));
  const close = await box(ov.getByTestId('ov-close'));
  expect(img.top, 'card top below the status bar').toBeGreaterThanOrEqual(L.top);
  expect(close.bottom, 'close button sits above the card, not on it').toBeLessThanOrEqual(img.top + 1);
  expect(close.top).toBeGreaterThanOrEqual(L.top);
  await shot(page, '10-card-detail');
  await scrollOverlay(page, 'expanded', 'bottom');
  const btn = await box(page.getByTestId('build-reagent'));
  expect(btn.bottom, 'action button clears the bottom bar').toBeLessThanOrEqual(L.bottom);
});

test('mats overlay scrolls as a whole: every card, including the last mat, clears the browser bar', async ({ page }) => {
  await open(page, (s) => {
    P(s, 'Keith').towers = ['assets/Tower_T1_Keep_of_Elixers.jpg'];
    s.tow_list = s.tow_list.filter((t) => !t.includes('T1_Keep_of_Elixers')); s.tower_deck = s.tow_list.length;
  });
  const b = await page.getByTestId('board').boundingBox();
  await page.touchscreen.tap(b.x + b.width * 0.52, b.y + b.height * 0.486);
  const ov = page.getByTestId('mats');
  await expect(ov).toBeVisible();
  await page.waitForTimeout(500);
  const L = await limits(page);
  const scrollable = await ov.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrollable, 'three mats do not fit one phone screen: the overlay must scroll').toBe(true);
  await expect(page.getByTestId('scroll-hint')).toBeVisible();
  const cards = ov.locator('.mcard');
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(6);
  for (let i = 0; i < n; i++) {
    await cards.nth(i).evaluate((c, top) => { const o = c.closest('.overlay'); o.scrollTop += c.getBoundingClientRect().top - top - 8; }, L.top);
    const r = await box(cards.nth(i));
    expect(r.top, `card ${i} top`).toBeGreaterThanOrEqual(L.top);
    expect(r.bottom, `card ${i} bottom`).toBeLessThanOrEqual(L.bottom);
  }
  await scrollOverlay(page, 'mats', 'bottom');
  const lastMat = await box(ov.locator('.mat').last());
  expect(lastMat.bottom, 'last mat clears the bottom bar').toBeLessThanOrEqual(L.bottom);
  await expect(page.getByTestId('scroll-hint')).toHaveClass(/off/);
  await shot(page, '11-mats-scrolled-to-end');
  const newtWizard = await box(page.getByTestId('mat-Newt').locator('.mcard').first());
  await scrollOverlay(page, 'mats', 'top');
  await page.getByTestId('mat-Newt').locator('.mcard').first().evaluate((c) => c.scrollIntoView({ block: 'center' }));
  const nw = await box(page.getByTestId('mat-Newt').locator('.mcard').first());
  expect(nw.bottom).toBeLessThanOrEqual(L.bottom);
  expect(newtWizard).toBeTruthy();
});

test('game end: scores stay reachable after dismissing, and Play again deals a fresh 3-player game', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, (s) => { s.tow_list = []; s.tower_deck = 0; });         // the face-up tower is the last one
  await page.getByTestId('slot-tower_face').tap();
  await page.getByTestId('build-reagent').tap();
  await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 60_000 });   // Newt and LizWiz finish the round first
  const v = await view(page);
  expect(v.game_over).toBe(true);
  const ranks = Object.entries(v.final).sort((a, b) => b[1] - a[1]);
  await expect(page.getByTestId('winner')).toContainText(ranks[0][0]);
  for (const [n, pts] of ranks) await expect(page.getByTestId('game-over').getByTestId(`final-${n}`)).toContainText(`${pts} VP`);
  await shot(page, '12-game-over');
  await page.getByTestId('go-close').tap();
  await expect(page.getByTestId('game-over')).toHaveCount(0);
  await expect(page.getByTestId('dock-status')).toContainText('Game over');
  await expect(page.getByTestId('dock-scores')).toBeVisible();
  await expect(page.getByTestId('turn')).toContainText(ranks[0][0]);
  await page.getByTestId('btn-menu').tap();
  await expect(page.getByTestId('menu-winner')).toContainText(ranks[0][0]);
  await expect(page.getByTestId('menu-scores').locator('.rank')).toHaveCount(3);
  await shot(page, '13-menu-final-scores');
  await page.getByTestId('menu-final-scores').tap();
  await expect(page.getByTestId('game-over')).toBeVisible();
  await page.getByTestId('go-close').tap();
  await page.getByTestId('dock-scores').tap();
  await expect(page.getByTestId('game-over')).toBeVisible();
  await page.getByTestId('go-new-game').tap();
  await expect(page.getByTestId('new-game-hand').locator('img')).toHaveCount(3);
  await expect(page.getByTestId('new-game-start')).toBeDisabled();
  await page.getByTestId('pick-Horn').tap();
  await page.getByTestId('pick-Mandrake').tap();
  await shot(page, '14-new-game-picks');
  await page.getByTestId('new-game-start').tap();
  await expect(page.getByTestId('new-game')).toHaveCount(0);
  const nv = await view(page);
  expect(nv.game_over).toBe(false);
  expect(nv.round).toBe(1);
  expect(nv.next).toBe('Keith');
  expect(nv.players.map((p) => p.name)).toEqual(['Keith', 'Newt', 'LizWiz']);
  expect([...me(nv).tok].sort()).toEqual(['Horn', 'Mandrake']);
  expect(nv.legal).toBeTruthy();
  await expect(page.getByTestId('slot-tower_face').locator('img')).toHaveAttribute('src', /art\/cards\/Tower_/);
  await page.reload();
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  expect((await view(page)).round, 'the new game is the autosave').toBe(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('every achievement tile a new deal can draw renders its icons (no missing art)', async ({ page }) => {
  const errors = watchErrors(page);
  const tiles = JSON.parse(fs.readFileSync(ACH_FILE, 'utf8')).achievements.tiles.map((t) => t.text);
  expect(tiles.length).toBeGreaterThanOrEqual(16);
  await open(page);
  for (let i = 0; i < tiles.length; i += 4) {
    const s = structuredClone(G8); s.ach = tiles.slice(i, i + 4);
    await page.evaluate((t) => localStorage.setItem('lw.save.v1', t), JSON.stringify(s));
    await page.reload();
    await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
    await expect(page.getByTestId('ach-0')).toBeVisible();
    await page.waitForLoadState('networkidle');
    for (const img of await page.locator('.ach img').all()) expect(await img.evaluate((e) => e.complete && e.naturalWidth > 0), await img.getAttribute('src')).toBe(true);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('branding is Lizard Wizard only; noindex kept; GoatCounter loads (no other tracker)', async ({ page }) => {
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await open(page);
  expect(await page.title()).toBe('Lizard Wizard');
  const meta = (n) => page.locator(`meta[name="${n}"]`).getAttribute('content');
  expect(await meta('application-name')).toBe('Lizard Wizard');
  expect(await meta('apple-mobile-web-app-title')).toBe('Lizard Wizard');
  expect(await meta('robots')).toContain('noindex');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Lizard Wizard');
  expect(manifest.short_name).toBe('Lizard Wizard');
  expect(JSON.stringify(manifest) + (await page.content())).not.toMatch(/mandalorian/i);
  await page.evaluate(() => { document.title = 'Mandalorian Soundboard'; });
  await expect.poll(() => page.title()).toBe('Lizard Wizard');
  const gc = page.locator('script[data-goatcounter]');
  await expect(gc).toHaveAttribute('data-goatcounter', 'https://lizard-wizard.goatcounter.com/count');
  await expect(gc).toHaveAttribute('src', 'https://gc.zgo.at/count.js');
  expect(await gc.evaluate((s) => s.async)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__goatcounterLoaded === true)).toBe(true);
  const thirdParty = scripts.filter((u) => !u.startsWith(new URL(page.url()).origin));
  expect(thirdParty).toEqual(['https://gc.zgo.at/count.js']);
  expect(await page.evaluate(() => document.cookie)).toBe('');
});
