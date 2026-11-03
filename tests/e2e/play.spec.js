// Plays game g8 at 390x844 with real taps only (touch taps on the board, hand, tokens and overlay buttons).
// The page state is READ through window.lwDebug (to choose taps and to assert); every move is made by tapping.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { watchErrors, boot, view, cards, me, shot, tapEmptyBoard, untilMyAction, waitOverlayGone, tapPutbacks, gatherPhase } from './helpers.js';

const cnt = (list) => list.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const covers = (have, need) => Object.entries(cnt(need)).every(([r, n]) => (have[r] || 0) >= n);
const costList = (c) => Object.entries(c?.cost?.reagents || {}).flatMap(([r, n]) => Array.from({ length: Number(n) || 0 }, () => r));
const until = async (page, pred, what) => {
  for (let i = 0; i < 150; i++) { const v = await view(page); if (pred(v)) return v; await page.waitForTimeout(200); }
  throw new Error(`timed out waiting for ${what}`);
};
const keepIdx = (offers, keep) => { const used = new Set(); return keep.map((r) => { const i = offers.findIndex((o, j) => o === r && !used.has(j)); used.add(i); return i; }); };

test('cold load at 390x844: g8 renders real cards, no console errors, playable in < 20 s', async ({ page }) => {
  const errors = watchErrors(page);
  const ms = await boot(page);
  const v = await view(page);
  expect(v.round).toBe(2);
  expect(v.next).toBe('Keith');
  await expect(page.getByTestId('slot-tower_face').locator('img')).toHaveAttribute('src', /art\/cards\/Tower_T1_Obelisk_of_Puzzles\.webp/);
  for (const slot of ['wiz_0', 'wiz_1', 'fam_0', 'fam_1', 'spell_0', 'spell_1', 'spell_2', 'spell_3']) {
    const ok = await page.getByTestId(`slot-${slot}`).locator('img').evaluate((img) => img.complete && img.naturalWidth > 300);
    expect(ok, `${slot} shows real card art`).toBe(true);
  }
  await expect(page.getByTestId('hand').locator('img')).toHaveCount(3);
  const hidden = v.players.filter((p) => !p.you).every((p) => p.mana === null && p.hand === null);
  expect(hidden, 'AI mana and reagent hands are not sent to the page').toBe(true);
  await page.waitForTimeout(1500);
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/load-time.json', JSON.stringify({ cold_load_to_playable_ms: ms, app_reported_ms: await page.evaluate(() => window.lwDebug.loadMs()) }));
  console.log(`COLD LOAD TO PLAYABLE: ${ms} ms`);
  expect(errors, errors.join('\n')).toEqual([]);
  expect(ms).toBeLessThan(20_000);
});

test('plays 3+ full rounds of g8 by taps: research, summon, build, gather+cast+put-back, bid, dungeon; AIs move', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  const db = await cards(page);
  const v0 = await view(page);
  const startRound = v0.round;
  await shot(page, '01-board');

  // mats overlay + expanded card (screenshots), then close both
  await tapEmptyBoard(page);
  await expect(page.getByTestId('mats')).toBeVisible();
  await expect(page.getByTestId('mat-Newt')).toContainText('?');          // AI mana hidden
  await shot(page, '03-mats-overlay');
  await page.getByTestId('mats').getByTestId('ov-close').tap();
  await waitOverlayGone(page, 'mats');

  const goals = { research: false, summon: false, build: false, gatherCastPutback: false, bid: false, dungeon: false };
  let castSpell = null;
  const onArena = async () => {
    const b = page.getByTestId('bid-pass');
    await b.tap({ timeout: 15_000 });
    await expect(b).toHaveCount(0, { timeout: 20_000 });
  };
  const settleMine = async () => untilMyAction(page, onArena);
  const handlePending = async () => {
    for (let i = 0; i < 40; i++) {
      const ov = await page.evaluate(() => [...document.querySelectorAll('#overlays .overlay:not(.out)')].map((o) => o.dataset.testid));
      if (ov.includes('effect')) { await page.getByTestId('effect-options').locator('button').first().tap(); await page.waitForTimeout(400); continue; }
      if (ov.includes('new-research')) { await page.locator('[data-testid^=nr-]').first().tap(); await page.waitForTimeout(400); continue; }
      return;
    }
  };

  async function gatherBy(handIndex, offers, keep, { cast = null, protect = [], castShot = false, putShot = false } = {}) {
    await page.getByTestId(`hand-${handIndex}`).tap();
    await expect(page.getByTestId('gather')).toBeVisible();
    for (const i of keepIdx(offers, keep)) await page.getByTestId(`hot-gather-${i}`).tap();
    let phase = await gatherPhase(page);
    let returned = [];
    if (phase === 'cast') {
      if (cast && await page.getByTestId(`cast-${cast}`).isVisible()) {
        if (castShot) await shot(page, '04-gather-cast-glow');
        await page.getByTestId(`cast-${cast}`).tap();
      } else { cast = null; await page.getByTestId('skip-cast').tap(); }
      await expect(page.getByTestId('skip-cast')).toHaveCount(0);
      phase = await gatherPhase(page);
    } else cast = null;
    if (phase === 'putback') {
      if (putShot) await shot(page, '05-putback-popup');
      returned = await tapPutbacks(page, protect);
      await waitOverlayGone(page, 'gather');
      phase = await gatherPhase(page);
    }
    expect(phase).toBe('done');
    return { cast, returned };
  }

  async function convertFor(manaNeeded) {
    let v = await view(page);
    while (me(v).mana < manaNeeded && Object.keys(v.legal.convert).length) {
      const [r] = Object.entries(v.legal.convert).sort((a, b) => b[1].n * b[1].value - a[1].n * a[1].value)[0];
      const m0 = me(v).mana;
      await page.getByTestId(`token-${r}`).tap();
      await page.getByTestId('convert-go').tap();
      v = await settleMine();
      expect(me(v).mana > m0 || v.round > 0).toBe(true);
      return v;
    }
    return v;
  }

  for (let turn = 0; turn < 30; turn++) {
    let v = await settleMine();
    if (v.game_over) break;
    const done = Object.values(goals).every(Boolean);
    if (done && v.round >= startRound + 3) break;
    const p = me(v); const L = v.legal;
    console.log(`R${v.round} Keith: mana ${p.mana} tok ${p.tok.length}/${p.cap} hand ${p.hand.join(',')} spells ${JSON.stringify(p.spells)} goals ${JSON.stringify(goals)}`);
    const before = { mana: p.mana, gold: p.gold, tok: p.tok.length, spells: p.spells.length, fam: p.familiars.length, towers: p.towers.length, log: v.log_len, round: v.round };

    // 1) research (research only): the cheapest fixed-cost spell on offer
    if (!goals.research && Object.keys(L.research).length && p.mana >= 10) {
      const options = Object.keys(L.research).filter((k) => !db[k].cost.variable).sort((a, b) => costList(db[a]).length - costList(db[b]).length);
      const sk = options[0]; castSpell = sk;
      const slot = v.board.spell_face.indexOf(sk);
      await page.getByTestId(`slot-spell_${slot}`).tap();
      await expect(page.getByTestId('expanded')).toBeVisible();
      await expect(page.getByTestId('card-text')).toContainText(db[sk].effect);
      if (!fs.existsSync('docs/screenshots/02-expanded-card.png')) await shot(page, '02-expanded-card');
      await page.getByTestId('research-only').tap();
      const after = me(await until(page, (x) => me(x).spells.length > before.spells, 'research'));
      expect(after.spells.length).toBe(before.spells + 1);
      expect(after.mana).toBe(before.mana - db[sk].cost.mana);
      expect(after.spells.at(-1)).toEqual({ key: sk, cast: false });
      goals.research = true; continue;
    }
    // 2) summon a familiar to gather
    const famGather = Object.entries(L.summon).filter(([, d]) => d.uses.includes('gather') && d.cost <= p.mana - 5).sort((a, b) => a[1].cost - b[1].cost)[0];
    if (!goals.summon && famGather) {
      const [fk, d] = famGather;
      await page.getByTestId(`slot-fam_${v.board.fam_face.indexOf(fk)}`).tap();
      await page.getByTestId('summon-gather').tap();
      let ph = await gatherPhase(page);
      if (ph === 'cast') { await page.getByTestId('skip-cast').tap(); await expect(page.getByTestId('skip-cast')).toHaveCount(0); ph = await gatherPhase(page); }
      if (ph === 'putback') { await tapPutbacks(page, castSpell ? costList(db[castSpell]) : []); await waitOverlayGone(page, 'summon-gather-flow'); ph = await gatherPhase(page); }
      expect(ph).toBe('done');
      await handlePending();
      const after = me(await until(page, (x) => me(x).familiars.length > before.fam, 'summon'));
      expect(after.familiars).toContain(fk);
      expect(after.mana).toBe(before.mana - d.cost);
      goals.summon = true; continue;
    }
    // 3) build the face-up tower
    if (!goals.build && L.build) {
      await page.getByTestId('slot-tower_face').tap();
      await page.getByTestId(L.build.reagent ? 'build-reagent' : 'build-gold').tap();
      const after = me(await until(page, (x) => me(x).towers.length > before.towers, 'build'));
      expect(after.towers).toContain(L.build.tower);
      expect(after.cap).toBe(p.cap + 1);
      goals.build = true; continue;
    }
    // 4) gather + cast + put-back: needs an uncast spell paid with the just-gathered reagents while over storage
    if (goals.research && !goals.gatherCastPutback) {
      let plan = null;
      for (const s of p.spells.filter((x) => x.key && !x.cast && !db[x.key].cost.variable)) {
        const cost = costList(db[s.key]);
        p.hand.forEach((hk, i) => {
          const g = L.gather[hk];
          for (const keep of g?.keeps || []) {
            if (plan) return;
            const hold = cnt([...p.tok, ...keep, ...g.bonus]);
            if (covers(hold, cost) && p.tok.length + keep.length + g.bonus.length - cost.length > p.cap) plan = { spell: s.key, i, keep, g, cost };
          }
        });
      }
      if (plan) {
        const r = await gatherBy(plan.i, plan.g.offers, plan.keep, { cast: plan.spell, protect: [], castShot: true, putShot: true });
        expect(r.cast).toBe(plan.spell);
        expect(r.returned.length).toBeGreaterThan(0);
        await handlePending();
        const after = me(await until(page, (x) => x.log_len > before.log, 'gather+cast'));
        expect(after.spells.find((s) => s.key === plan.spell).cast).toBe(true);
        expect(after.tok.length).toBe(after.cap);
        goals.gatherCastPutback = true; continue;
      }
      if (p.tok.length < p.cap + 1) {
        // fill storage first, keeping the reagents the spell needs
        const need = castSpell ? costList(db[castSpell]) : [];
        let best = null;
        p.hand.forEach((hk, i) => {
          const g = L.gather[hk];
          for (const keep of g.keeps) {
            const sc = keep.filter((r) => need.includes(r)).length;
            if (!best || sc > best.sc) best = { i, keep, g, sc };
          }
        });
        await gatherBy(best.i, best.g.offers, best.keep, { protect: need });
        const after = me(await until(page, (x) => x.log_len > before.log, 'gather'));
        expect(after.tok.length).toBeGreaterThanOrEqual(Math.min(before.tok + 1, after.cap));
        continue;
      }
    }
    // 5) bid on a wizard (open at 1, then pass when outbid)
    if (!goals.bid && L.recruit.length && p.mana >= 1) {
      const wz = L.recruit[0];
      await page.getByTestId(`slot-wiz_${v.board.wiz_face.indexOf(wz)}`).tap();
      await expect(page.getByTestId('arena')).toBeVisible();
      await expect(page.getByTestId('bid-slider')).toBeVisible();
      await shot(page, '06-bidding-arena');
      await page.getByTestId('bid-go').tap();
      for (let k = 0; k < 60 && (await page.getByTestId('arena').count()); k++) {
        if (await page.getByTestId('bid-pass').isEnabled({ timeout: 300 }).catch(() => false)) await onArena();
        await page.waitForTimeout(250);
      }
      await waitOverlayGone(page, 'arena');
      const lg = await page.evaluate(() => window.lwDebug.log());
      const au = lg.filter((e) => e.act === 'auction').at(-1);
      expect(au.bids[0]).toEqual(['Keith', 1]);
      goals.bid = true; continue;
    }
    // 6) dungeon run through a familiar, card by card
    const famDun = Object.entries(L.summon).filter(([, d]) => d.uses.includes('dungeon')).sort((a, b) => a[1].cost - b[1].cost)[0];
    if (!goals.dungeon && famDun && famDun[1].cost <= p.mana) {
      const [fk] = famDun;
      await page.getByTestId(`slot-fam_${v.board.fam_face.indexOf(fk)}`).tap();
      await page.getByTestId('summon-dungeon').tap();
      await expect(page.getByTestId('dungeon')).toBeVisible();
      for (let k = 0; k < 3; k++) {
        if (!(await page.getByTestId('dungeon-deck').evaluate((d) => d.classList.contains('live')))) break;
        await page.getByTestId('dungeon-deck').tap();
        const pd = (await until(page, (x) => x.pending && x.pending.drawn.length === k + 1, 'dungeon flip')).pending;
        await page.waitForTimeout(500);
        if (k === 1) await shot(page, '07-dungeon');
        if (pd.hits >= 1 || pd.done) break;
      }
      const btn = (await page.getByTestId('dungeon-continue').count()) ? 'dungeon-continue' : 'dungeon-stop';
      await page.getByTestId(btn).tap();
      await waitOverlayGone(page, 'dungeon');
      const lg = await page.evaluate(() => window.lwDebug.log());
      const dn = lg.filter((e) => e.act === 'dungeon' && e.who === 'Keith').at(-1);
      expect(dn.drawn.length).toBeGreaterThan(0);
      const after = me(await until(page, (x) => me(x).familiars.length > before.fam, 'dungeon summon'));
      expect(after.familiars).toContain(fk);
      goals.dungeon = true; continue;
    }
    // need mana for an open goal -> convert reagents
    if ((!goals.dungeon || !goals.bid) && p.mana < 10 && Object.keys(L.convert).length) { await convertFor(10); continue; }
    // otherwise: a plain gather (skip any cast, put back if over)
    const hk = p.hand[0]; const g = L.gather[hk];
    await gatherBy(0, g.offers, g.keeps[0], { protect: castSpell ? costList(db[castSpell]) : [] });
  }

  const v = await view(page);
  expect(goals).toEqual({ research: true, summon: true, build: true, gatherCastPutback: true, bid: true, dungeon: true });
  expect(v.round - startRound).toBeGreaterThanOrEqual(3);
  const lg = await page.evaluate(() => window.lwDebug.log());
  for (let r = startRound; r < v.round; r++) {
    for (const ai of ['Newt', 'LizWiz']) {
      expect(lg.some((e) => e.act === 'turn' && e.who === ai && e.r === r), `${ai} had a turn in round ${r}`).toBe(true);
      expect(lg.some((e) => e.who === ai && e.r === r && e.act !== 'turn'), `${ai} acted in round ${r}`).toBe(true);
    }
  }
  // log drawer with the full history
  await page.getByTestId('btn-log').tap();
  await expect(page.getByTestId('log-item').first()).toBeVisible();
  const items = await page.getByTestId('log-item').count();
  expect(items).toBeGreaterThan(10);
  await shot(page, '08-log-drawer');
  await page.getByTestId('log-close').tap();
  fs.writeFileSync('test-results/play-summary.json', JSON.stringify({ startRound, endRound: v.round, goals, logEntries: lg.length, keith: me(v) }, null, 1));
  expect(errors, errors.join('\n')).toEqual([]);
});
