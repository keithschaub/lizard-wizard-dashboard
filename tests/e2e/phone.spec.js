// Phone layout + playtest fixes (Keith's iPhone playtest): pickers, card detail and mats never clip under the status bar
// or Safari's bottom bar; the end of the game keeps the scores and offers a new game; branding; GoatCounter.
// iPhone safe areas and Safari's floating toolbar are simulated with the CSS variables the layout uses.
import { test, expect } from './fixtures.js';
import fs from 'fs';
import { watchErrors, view, shot, me } from './helpers.js';

const INSET = { top: 59, bottom: 34, chrome: 84 };          // Dynamic Island status bar (iPhone 14 Pro and later), home indicator, Safari bar
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

for (const [name, tower] of [['Obelisk of Puzzles', 'Tower_T1_Obelisk_of_Puzzles'], ['Obsidian Fortress', 'Tower_T1_Obsidian_Fortress']]) {
  test(`card detail (${name}): the card's top edge and title sit fully below the status bar and close row, uncropped`, async ({ page }) => {
    await open(page, (s) => {
      const t = `assets/${tower}.jpg`;
      if (s.tower_face !== t) { s.tow_list = s.tow_list.filter((x) => x !== t); s.tow_list.unshift(s.tower_face); s.tower_face = t; }
    });
    await page.getByTestId('slot-tower_face').tap();
    const ov = page.getByTestId('expanded');
    await expect(ov).toBeVisible();
    await expect(page.getByTestId('expanded-img')).toHaveAttribute('src', new RegExp(tower));
    await page.getByTestId('expanded-img').evaluate((i) => i.decode());
    await page.waitForTimeout(500);                                   // zoom-in animation
    await scrollOverlay(page, 'expanded', 'top');
    const L = await limits(page);
    const m = await page.getByTestId('expanded-card').evaluate((frame) => {
      const img = frame.querySelector('img'); const f = frame.getBoundingClientRect(); const r = img.getBoundingClientRect();
      const close = frame.closest('.overlay').querySelector('[data-testid=ov-close]').getBoundingClientRect();
      let clipped = null;
      for (let a = img.parentElement; a && !a.classList.contains('overlay'); a = a.parentElement) {
        const st = getComputedStyle(a);
        if (st.overflow === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (r.top < ar.top - 0.5 || r.bottom > ar.bottom + 0.5) clipped = a.className;
      }
      const probe = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.03);   // the title band
      return { f: { top: f.top, bottom: f.bottom }, r: { top: r.top, bottom: r.bottom, w: r.width, h: r.height }, close: close.bottom, closeTop: close.top,
        art: img.naturalHeight / img.naturalWidth, clipped, titleOnTop: probe === img };
    });
    expect(m.closeTop, 'close button below the status bar').toBeGreaterThanOrEqual(L.top);
    expect(m.f.top, 'card frame below the close row').toBeGreaterThanOrEqual(m.close);
    expect(m.f.top, 'card frame below the status bar').toBeGreaterThanOrEqual(L.top);
    expect(m.r.top - m.f.top, 'a frame margin above the card art (the scans are trimmed at the title)').toBeGreaterThanOrEqual(m.r.w * 0.05);
    expect(Math.abs(m.r.h / m.r.w / m.art - 1), 'card art shown whole (not cropped by CSS)').toBeLessThan(0.01);
    expect(m.clipped, `card art clipped by .${m.clipped}`).toBeNull();
    expect(m.titleOnTop, 'nothing covers the card title').toBe(true);
    expect(m.f.bottom, 'the whole card fits above the Safari bar').toBeLessThanOrEqual(L.bottom);
    await shot(page, `10-card-detail-${tower.split('_').slice(2).join('-').toLowerCase()}`);
    await scrollOverlay(page, 'expanded', 'bottom');
    const btn = await box(page.getByTestId('build-reagent'));
    expect(btn.bottom, 'action button clears the bottom bar').toBeLessThanOrEqual(L.bottom);
  });
}

test('mats: no card is cropped, overlapped or clipped; every card scrolls fully clear of the status bar and Safari bar', async ({ page }) => {
  // Keith's playtest mat: Obelisk of Puzzles (the narrowest tower scan) under an empty wizard slot; Newt's wizard further down.
  await open(page, (s) => {
    P(s, 'Keith').towers = ['assets/Tower_T1_Obelisk_of_Puzzles.jpg'];
    s.tow_list = s.tow_list.filter((t) => !t.includes('T1_Obelisk_of_Puzzles'));
    if (s.tower_face?.includes('Obelisk_of_Puzzles')) s.tower_face = s.tow_list.shift();
    s.tower_deck = s.tow_list.length;
  });
  const b = await page.getByTestId('board').boundingBox();
  await page.touchscreen.tap(b.x + b.width * 0.52, b.y + b.height * 0.486);
  const ov = page.getByTestId('mats');
  await expect(ov).toBeVisible();
  await page.waitForTimeout(500);
  await ov.evaluate((el) => Promise.all([...el.querySelectorAll('.mcard img')].map((i) => i.decode().catch(() => {}))));
  const L = await limits(page);
  expect(await ov.evaluate((el) => el.scrollHeight > el.clientHeight), 'three mats do not fit one phone screen: the overlay must scroll').toBe(true);

  // Every card image shows whole: its box has the card's own proportions (no object-fit crop of title or border).
  const crops = await ov.evaluate((el) => [...el.querySelectorAll('.mcard img')].map((i) => {
    const r = i.getBoundingClientRect();
    return { src: i.getAttribute('src'), loaded: i.complete && i.naturalWidth > 0, box: r.height / r.width, art: i.naturalHeight / i.naturalWidth };
  }));
  expect(crops.length).toBeGreaterThanOrEqual(6);
  for (const c of crops) {
    expect(c.loaded, `${c.src} loaded`).toBe(true);
    expect(Math.abs(c.box / c.art - 1), `${c.src} is shown whole (box ${c.box.toFixed(3)} vs art ${c.art.toFixed(3)})`).toBeLessThan(0.02);
  }
  const obelisk = crops.find((c) => c.src.includes('Obelisk_of_Puzzles'));
  expect(obelisk, "Keith's Obelisk of Puzzles is on his mat").toBeTruthy();

  // No card overlaps another card or the empty wizard slot above it.
  const overlaps = await ov.evaluate((el) => {
    const rs = [...el.querySelectorAll('.mcard')].map((c) => ({ r: c.getBoundingClientRect(), k: c.querySelector('img')?.getAttribute('src') || c.className }));
    const out = [];
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i].r, b = rs[j].r;
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(`${rs[i].k} x ${rs[j].k}`);
    }
    return out;
  });
  expect(overlaps, overlaps.join('\n')).toEqual([]);

  // Each card can be scrolled to sit fully between the status bar and the Safari bar, and no box inside the overlay clips it.
  const cards = ov.locator('.mcard');
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const r = await cards.nth(i).evaluate((c, top) => {
      const o = c.closest('.overlay'); o.scrollTop += c.getBoundingClientRect().top - top - 8;
      const cr = c.getBoundingClientRect(); let clipped = null;
      for (let a = c.parentElement; a && a !== o; a = a.parentElement) {
        const st = getComputedStyle(a);
        if (st.overflow === 'visible' && st.overflowX === 'visible' && st.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (cr.top < ar.top - 0.5 || cr.bottom > ar.bottom + 0.5 || cr.left < ar.left - 0.5 || cr.right > ar.right + 0.5) clipped = a.className;
      }
      return { top: cr.top, bottom: cr.bottom, clipped, k: c.querySelector('img')?.getAttribute('src') || c.className };
    }, L.top);
    expect(r.clipped, `${r.k} clipped by .${r.clipped}`).toBeNull();
    expect(r.top, `${r.k} top clears the status bar`).toBeGreaterThanOrEqual(L.top);
    expect(r.bottom, `${r.k} bottom clears the Safari bar`).toBeLessThanOrEqual(L.bottom);
  }

  // From the top, the "more below" button scrolls the mats; at the end, the last mat clears the bar.
  await scrollOverlay(page, 'mats', 'top');
  await shot(page, '16-mats-obelisk-whole');
  const y0 = await ov.evaluate((el) => el.scrollTop);
  const hb = await page.getByTestId('scroll-hint').boundingBox();       // it bobs, so tap its centre directly
  await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await expect.poll(() => ov.evaluate((el) => el.scrollTop)).toBeGreaterThan(y0 + 100);
  await scrollOverlay(page, 'mats', 'bottom');
  const lastMat = await box(ov.locator('.mat').last());
  expect(lastMat.bottom, 'last mat clears the bottom bar').toBeLessThanOrEqual(L.bottom);
  await expect(page.getByTestId('scroll-hint')).toHaveClass(/off/);
  const newtWizard = await page.getByTestId('mat-Newt').locator('.mcard').first().evaluate((c, top) => {
    const o = c.closest('.overlay'); o.scrollTop += c.getBoundingClientRect().top - top - 8; return c.getBoundingClientRect().bottom;
  }, L.top);
  expect(newtWizard, "Newt's wizard scrolls fully above the Safari bar").toBeLessThanOrEqual(L.bottom);
  await shot(page, '11-mats-scrolled-to-end');
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
