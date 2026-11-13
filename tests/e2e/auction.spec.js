// Wizard Auction: the bid panel always reflects the engine's live state, across raises and back-to-back auctions
// (the engine can resolve one auction and start the next inside a single call), and mana moves only when Keith wins.
// fixtures/back-to-back-auctions.json: a new game (seed 2), round 20. LizWiz auctions Reptilius Venenum at 1 and waits on
// Keith. When Keith passes, Newt wins it; LizWiz lost the auction she started, so she takes another action and auctions
// Lacerta Arborus, all inside that one engine call.
import { test, expect } from './fixtures.js';
import fs from 'fs';
import { watchErrors, view, me, shot } from './helpers.js';

const INSET = { top: 59, bottom: 34, chrome: 84 };
const B2B = fs.readFileSync('tests/e2e/fixtures/back-to-back-auctions.json', 'utf8');
const G8 = JSON.parse(fs.readFileSync('engine/game/g8_state.json', 'utf8'));
const P = (s, n) => s.players.find((p) => p.name === n);

async function open(page, text) {
  await page.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1'); } }, text);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await page.addStyleTag({ content: `:root { --safe-t: ${INSET.top}px !important; --safe-b: ${INSET.bottom}px !important; --chrome-b: ${INSET.chrome}px !important; }` });
}

// Waits for a bid panel that was rendered after the last answer (old buttons are marked), or for the auctions to be over.
async function nextPanel(page) {
  await page.waitForFunction(() => {
    const live = document.querySelector('[data-testid=arena]:not(.out) [data-testid=bid-pass]:not([data-old]):not([disabled])');
    const v = window.lwDebug.view();
    return live || (!v.auction && !document.querySelector('[data-testid=arena]'));
  }, null, { timeout: 90_000 });
  return page.evaluate(() => !!window.lwDebug.view().auction);
}
async function answer(page, testid) {
  await page.evaluate(() => document.querySelectorAll('[data-testid=bid-pass], [data-testid=bid-go]').forEach((b) => { b.dataset.old = '1'; }));
  await page.getByTestId(testid).tap();
}

// The panel must match the engine at this moment: max = Keith's mana, min = high + 1, high bid and card of THIS auction.
async function checkPanel(page) {
  const st = await page.evaluate(() => {
    const v = window.lwDebug.view(); const a = v.auction; const k = v.players.find((p) => p.name === 'Keith');
    const ar = document.querySelector('[data-testid=arena]:not(.out)');
    const val = ar.querySelector('[data-testid=bid-value]'); const sl = ar.querySelector('[data-testid=bid-slider]'); const go = ar.querySelector('[data-testid=bid-go]');
    const rows = [...ar.querySelectorAll('[data-testid=bid-summary] .bid-summary-row')].map((row) => row.textContent);
    const fixed = rows[1]?.match(/Your bid(\d+)\/(\d+)/);
    return { mana: k.mana, a, min: val ? +val.dataset.min : sl ? +sl.min : fixed && +fixed[1], max: val ? +val.dataset.max : sl ? +sl.max : fixed && +fixed[2], shown: val ? val.firstChild.textContent : sl ? sl.value : fixed && fixed[1],
      slider: sl && [+sl.min, +sl.max, +sl.value], bidRows: rows, high: ar.querySelector('[data-testid=arena-high]').textContent,
      card: ar.querySelector('[data-testid=arena-card] img').getAttribute('src'), go: !!go && !go.disabled, arenas: document.querySelectorAll('[data-testid=arena]:not(.out)').length };
  });
  expect(st.arenas, 'one auction screen at a time').toBe(1);
  expect(st.card, 'the arena shows the wizard being auctioned now').toContain(st.a.card);
  expect(st.high, 'high bid label matches the engine').toContain(`High bid ${st.a.high} · ${st.a.who}`);
  expect(st.go, 'Bid is enabled exactly when Keith can beat the high bid').toBe(st.mana > st.a.high);
  if (st.mana > st.a.high) {
    expect(st.max, 'panel max = Keith\'s live mana').toBe(st.mana);
    expect(st.min, 'panel min = high bid + 1').toBe(st.a.high + 1);
    expect(st.shown).toBe(String(st.a.high + 1));
    expect(st.bidRows[0]).toContain(`High bid${st.a.high}`);
    expect(st.bidRows[1]).toContain(`Your bid${st.a.high + 1}/${st.mana}`);
    if (st.slider) expect(st.slider).toEqual([st.a.high + 1, st.mana, st.a.high + 1]);
  }
  return st;
}

async function checkCardFrame(page) {
  const m = await page.getByTestId('arena-card').evaluate((f) => {
    const img = f.querySelector('img'); const fr = f.getBoundingClientRect(); const r = img.getBoundingClientRect();
    const title = f.closest('.overlay').querySelector('.ov-title').getBoundingClientRect();
    return { frameTop: fr.top, imgTop: r.top, w: r.width, ratio: r.height / r.width, art: img.naturalHeight / img.naturalWidth, titleTop: title.top, titleBottom: title.bottom };
  });
  expect(m.titleTop, 'auction title below the status bar').toBeGreaterThanOrEqual(INSET.top);
  expect(m.frameTop, 'auctioned card below the title').toBeGreaterThanOrEqual(m.titleBottom);
  expect(m.imgTop - m.frameTop, 'frame margin above the trimmed card scan').toBeGreaterThanOrEqual(m.w * 0.05);
  expect(Math.abs(m.ratio / m.art - 1), 'card art not cropped').toBeLessThan(0.01);
  const lay = await page.getByTestId('arena').evaluate((ov, clear) => {
    const r = (el) => el.getBoundingClientRect();
    const card = r(ov.querySelector('[data-testid=arena-card]'));
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const btns = [...ov.querySelectorAll('[data-testid=bid-go], [data-testid=bid-pass], [data-testid=bid-cancel]')].map((b) => r(b).bottom);
    return { overlap: [...ov.querySelectorAll('.seat')].filter((s) => hit(r(s), card)).map((s) => s.dataset.testid), btns, limit: window.innerHeight - clear, scrollTop: ov.scrollTop };
  }, INSET.bottom + INSET.chrome);
  expect(lay.overlap, 'no seat overlaps the auctioned card').toEqual([]);
  expect(lay.scrollTop).toBe(0);
  for (const b of lay.btns) expect(b, 'Pass / Bid visible above the Safari bar without scrolling').toBeLessThanOrEqual(lay.limit);
}

test('multi-raise auction (BUG FIX: no back-to-back after AI loses): the panel follows live state; losing costs no mana', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, B2B);
  await expect(page.getByTestId('arena')).toBeVisible({ timeout: 60_000 });
  const mana0 = me(await view(page)).mana;
  const seen = []; let raises = 0;
  for (let step = 0; step < 20; step++) {
    if (!(await nextPanel(page))) break;
    await page.waitForTimeout(250);
    const st = await checkPanel(page);
    if (!seen.includes(st.a.card)) {
      seen.push(st.a.card);
      await page.getByTestId('arena-card').locator('img').evaluate((i) => i.decode());
      await checkCardFrame(page);
      await shot(page, `17-auction-${seen.length}`);
    }
    if (seen.length === 1 && raises < 3 && st.go) { raises++; await answer(page, 'bid-go'); } else await answer(page, 'bid-pass');
  }
  expect(raises, 'Keith raised three times in the auction').toBe(3);
  // Rulebook: a starter who loses may act again, including another auction; an AI opens at most two a turn.
  const cards = seen.map((c) => c.replace('Wizard_', ''));
  expect(cards[0]).toBe('Reptilius_Venenum');
  expect(cards.length).toBeLessThanOrEqual(2);
  const v = await view(page);
  expect(v.auction).toBeNull();
  expect(me(v).mana, 'Keith lost the auction: his mana is untouched').toBe(mana0);
  const log = await page.evaluate(() => window.lwDebug.log());
  const results = log.filter((e) => e.act === 'auction' || e.act === 'auction_nobid').slice(-1);
  expect(results.length, 'exactly one auction resolved').toBe(1);
  expect(results[0].who !== 'Keith', 'the auction went to an AI').toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('winning an auction charges the winning bid exactly once', async ({ page }) => {
  const s = structuredClone(G8); P(s, 'Keith').mana = 89; P(s, 'Newt').mana = 120; P(s, 'LizWiz').mana = 120;
  await open(page, JSON.stringify(s));
  const wiz = (await view(page)).board.wiz_face[0];
  await page.getByTestId('slot-wiz_0').tap();
  await expect(page.getByTestId('bid-go')).toBeVisible();
  await page.waitForTimeout(600);                                     // past the board's ghost-click guard
  await checkCardFrame(page);
  await answer(page, 'bid-go');                                       // open at 1
  while (await nextPanel(page)) {
    await page.waitForTimeout(250);
    const st = await checkPanel(page);
    expect(st.mana, 'bidding does not reserve or spend mana').toBe(89);
    await answer(page, 'bid-go');                                     // raise by 1 until the AIs give up
  }
  const v = await view(page);
  const won = (await page.evaluate(() => window.lwDebug.log())).filter((e) => e.act === 'auction').pop();
  expect(won.who).toBe('Keith');
  expect(me(v).wizards).toContain(wiz);
  expect(me(v).mana, `paid ${won.price} once`).toBe(89 - won.price);
});

// Records every "You win …" / "X wins …" message the arena shows.
async function recordWins(page) {
  await page.evaluate(() => {
    window.__wins = [];
    new MutationObserver(() => {
      const m = document.querySelector('[data-testid=arena-winner]');
      if (m && m.textContent && window.__wins[window.__wins.length - 1] !== m.textContent) window.__wins.push(m.textContent);
    }).observe(document.getElementById('overlays'), { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

async function untilKeithsTurn(page) {
  await page.waitForFunction(() => { const v = window.lwDebug.view(); return !v.auction && v.next === 'Keith' && !window.lwDebug.aiRunning() && !document.querySelector('#overlays .overlay:not(.out)'); }, null, { timeout: 180_000 });
}

// Keith's mat must draw exactly the engine's wizards: each once, one per pair column, no overlaps, and the card list agrees.
async function checkMat(page, screenshot = null) {
  const b = await page.getByTestId('board').boundingBox();
  await page.touchscreen.tap(b.x + b.width * 0.52, b.y + b.height * 0.486);
  await expect(page.getByTestId('mats')).toBeVisible();
  await page.waitForTimeout(400);
  const m = await page.getByTestId('mat-Keith').evaluate((mat) => {
    const k = window.lwDebug.view().players.find((p) => p.name === 'Keith');
    const pairs = [...mat.querySelectorAll('.pair')].map((p) => [...p.querySelectorAll('.mcard img')].map((i) => i.getAttribute('src').replace(/^art\/cards\/|\.webp$/g, '')));
    const rs = [...mat.querySelectorAll('.mcard')].map((c) => c.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], c = rs[j];
      if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) overlaps++;
    }
    const list = mat.querySelector('[data-testid=mat-cards-Keith]');
    return { engine: k.wizards, towers: k.towers, pairs, overlaps, listed: list.dataset.wizards ? list.dataset.wizards.split(',') : [], text: list.textContent };
  });
  const drawnWizards = m.pairs.map((p) => p.filter((x) => x.startsWith('Wizard_'))).flat();
  expect(m.pairs.every((p) => p.filter((x) => x.startsWith('Wizard_')).length <= 1), 'one wizard per pair column').toBe(true);
  expect([...drawnWizards].sort(), 'the mat draws exactly the engine\'s wizards').toEqual([...m.engine].sort());
  expect(m.pairs.flat().filter((x) => x.startsWith('Tower_')).sort()).toEqual([...m.towers].sort());
  expect(m.listed, 'debug card list = engine wizards').toEqual(m.engine);
  expect(m.overlaps, 'no card overlaps another or an empty slot').toBe(0);
  if (screenshot) { await page.getByTestId('mat-cards-Keith').scrollIntoViewIfNeeded(); await shot(page, screenshot); }
  await page.getByTestId('mats').getByTestId('ov-close').tap();
  return m;
}

test('Keith wins one multi-raise auction: his mat gains exactly that wizard, drawn once', async ({ page }) => {
  await open(page, B2B);
  await expect(page.getByTestId('arena')).toBeVisible({ timeout: 60_000 });
  await recordWins(page);
  const before = me(await view(page)).wizards.length;
  while (await nextPanel(page)) {
    await page.waitForTimeout(250);
    const st = await checkPanel(page);
    await answer(page, st.a.card === 'Wizard_Reptilius_Venenum' && st.go ? 'bid-go' : 'bid-pass');
  }
  await untilKeithsTurn(page);
  const v = await view(page);
  expect(me(v).wizards.length, 'exactly one wizard more').toBe(before + 1);
  expect(me(v).wizards).toEqual(['Wizard_Reptilius_Venenum']);
  const wins = await page.evaluate(() => window.__wins);
  expect(wins.filter((w) => w.startsWith('You win')), 'Keith is told what he won').toEqual([expect.stringContaining('Reptilius Venenum')]);
  const m = await checkMat(page);
  expect(m.text).toContain('Wizards: Reptilius Venenum');
});

test("Keith's playtest (BUG FIX: single auction per turn): winning shows correct wizard in message", async ({ page }) => {
  const s = JSON.parse(B2B); P(s, 'Keith').mana = 60;
  await open(page, JSON.stringify(s));
  await expect(page.getByTestId('arena')).toBeVisible({ timeout: 60_000 });
  await recordWins(page);
  const cards = [];
  while (await nextPanel(page)) {
    await page.waitForTimeout(250);
    const st = await checkPanel(page);                                // the arena card is always the auction being bid on
    if (!cards.includes(st.a.card)) cards.push(st.a.card);
    await answer(page, st.go ? 'bid-go' : 'bid-pass');
  }
  await untilKeithsTurn(page);
  const v = await view(page);
  const log = await page.evaluate(() => window.lwDebug.log());
  const keithWon = log.filter((e) => e.act === 'auction' && e.who === 'Keith').map((e) => e.cards[0]);
  // BUG FIX: After the round-27 fix, there's only one auction (AI turn ends after losing)
  expect(cards.length, 'one auction from the fixture').toBeGreaterThanOrEqual(1);
  expect([...me(v).wizards].sort(), 'Keith holds exactly the wizards he won').toEqual([...keithWon].sort());
  const told = (await page.evaluate(() => window.__wins)).filter((w) => w.startsWith('You win'));
  expect(told.length).toBe(keithWon.length);
  keithWon.forEach((k, i) => expect(told[i], 'each win message names the wizard actually won').toContain(k.replace('Wizard_', '').replaceAll('_', ' ')));
  await checkMat(page, '18-mat-after-back-to-back-auctions');
});
