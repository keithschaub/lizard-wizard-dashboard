// Full automated playthroughs (Keith's playtest pass). Three complete games per browser: g8 to the end, and two seeded
// new games. Keith is played by taps only; the page state is read through window.lwDebug to choose taps and to assert.
// The first AI sequence of each game is watched at full pacing (each move >= 4 s), the second is skipped with Skip, and
// later ones are skipped too (Skip is a real player action) so a whole game fits in CI.
// Every major screen is captured to docs/screenshots/playtest/<project>/ and checked: cards whole and reachable between
// the (simulated) status bar and Safari bar, auction panel = engine, mats = engine wizards, Lizard Wizard branding.
import { test, expect } from './fixtures.js';
import fs from 'fs';
import { watchErrors, view, cards, me, projectName, gatherPhase, tapPutbacks } from './helpers.js';

const INSET = { top: 59, bottom: 34, chrome: 84 };
const G8_AUTO = fs.readFileSync('engine/game/g8_auto_advanced.json', 'utf8');
const RUNS = [
  { id: 'run1-g8', from: 'g8' },
  { id: 'run2-new-seed-7', from: 'new', seeds: { seed: 7, ai_seed: 7, board_seed: 7 } },
  { id: 'run3-new-seed-31', from: 'new', seeds: { seed: 31, ai_seed: 31, board_seed: 31 } },
];
const MECHANICS = ['gatherUnselect', 'gatherCastPutback', 'convert', 'research', 'researchCast', 'buildReagent', 'summon', 'dungeon',
  'auctionOpen', 'auctionMultiRaise', 'auctionWin', 'auctionPass', 'aiPaced', 'aiSkip', 'gameOver', 'playAgain'];
const OPTIONAL = ['buildGold', 'newResearch', 'scryPicker'];
const SCREENS = ['board', 'dock', 'mats-top', 'mats-end', 'card-tower', 'card-wizard', 'card-spell', 'picker', 'arena', 'ai-banner', 'game-over', 'menu'];

const cnt = (list) => list.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const covers = (have, need) => Object.entries(cnt(need)).every(([r, n]) => (have[r] || 0) >= n);
const costList = (c) => Object.entries(c?.cost?.reagents || {}).flatMap(([r, n]) => Array.from({ length: Number(n) || 0 }, () => r));
const keepIdx = (offers, keep) => { const used = new Set(); return keep.map((r) => { const i = offers.findIndex((o, j) => o === r && !used.has(j)); used.add(i); return i; }); };

class Playtest {
  constructor(page, run) {
    this.page = page; this.run = run; this.n = 0; this.cov = {}; this.screens = {}; this.notes = [];
    this.dir = `docs/screenshots/playtest/${projectName()}`;
    this.auctionSeen = new Set(); this.auctionPlan = null; this.aiSequences = 0; this.lastWizards = null; this.keithTurns = 0;
  }
  mark(k) { this.cov[k] = (this.cov[k] || 0) + 1; }
  async shot(label) {
    fs.mkdirSync(this.dir, { recursive: true });
    this.n += 1;
    const path = `${this.dir}/${this.run.id}-${String(this.n).padStart(2, '0')}-${label}.jpg`;
    await this.page.waitForTimeout(350);
    await this.page.screenshot({ path, type: 'jpeg', quality: 70, scale: 'css' });
    this.screens[label] = path;
  }
  async limits() { return this.page.evaluate(({ top, bottom, chrome }) => ({ top, bottom: window.innerHeight - bottom - chrome, h: window.innerHeight, home: window.innerHeight - bottom }), INSET); }
  async overlays() { return this.page.evaluate(() => [...document.querySelectorAll('#overlays .overlay:not(.out)')].map((o) => o.dataset.testid)); }

  // ---------------------------------------------------------------- visual checks
  // Every card image in the overlay is shown whole (box ratio = scan ratio) and can be scrolled fully between the status
  // bar and the Safari bar.
  async checkOverlayCards(testid, selector, what) {
    const L = await this.limits();
    const ov = this.page.getByTestId(testid);
    await ov.evaluate((el, sel) => Promise.all([...el.querySelectorAll(sel)].map((c) => (c.tagName === 'IMG' ? c : c.querySelector('img'))).filter(Boolean).map((i) => i.decode().catch(() => {}))), selector);
    const n = await ov.locator(selector).count();
    for (let i = 0; i < n; i++) {
      const r = await ov.locator(selector).nth(i).evaluate((c, top) => {
        const o = c.closest('.overlay'); o.scrollTop += c.getBoundingClientRect().top - top - 8;
        const img = c.tagName === 'IMG' ? c : c.querySelector('img');
        const cr = c.getBoundingClientRect(); const ir = img?.getBoundingClientRect();
        return { top: cr.top, bottom: cr.bottom, h: cr.height, ratio: ir && ir.height / ir.width, art: img && img.naturalHeight / img.naturalWidth, src: img?.getAttribute('src') };
      }, L.top);
      if (r.art) expect(Math.abs(r.ratio / r.art - 1), `${what}: ${r.src} shown whole`).toBeLessThan(0.02);
      expect(r.top, `${what}: ${r.src} top below the status bar`).toBeGreaterThanOrEqual(L.top - 0.5);
      if (r.h <= L.bottom - L.top) expect(r.bottom, `${what}: ${r.src} bottom above the Safari bar`).toBeLessThanOrEqual(L.bottom + 0.5);
    }
    await ov.evaluate((el) => { el.scrollTop = 0; });
    return n;
  }

  // Board slots and hand cards show each scan whole; the hand sits above the home indicator.
  async checkBoardAndDock() {
    await this.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=board], [data-testid=hand]')].every((e) => e.getAnimations({ subtree: true })
      .every((an) => an.playState !== 'running' || an.effect?.getTiming().iterations === Infinity)), null, { timeout: 10_000 });
    const r = await this.page.evaluate((home) => {
      const imgs = [...document.querySelectorAll('[data-testid^=slot-] img, [data-testid=hand] img')].filter((i) => i.complete && i.naturalWidth);
      const crop = imgs.map((i) => { const b = i.getBoundingClientRect(); return { src: i.getAttribute('src'), d: Math.abs((b.height / b.width) / (i.naturalHeight / i.naturalWidth) - 1) }; }).filter((x) => x.d > 0.02);
      const hand = [...document.querySelectorAll('[data-testid=hand] img')].map((i) => i.getBoundingClientRect()).map((b) => ({ top: b.top, bottom: b.bottom }));
      return { crop, hand, home, n: imgs.length };
    }, (await this.limits()).home);
    expect(r.n).toBeGreaterThan(8);
    expect(r.crop, `board / hand cards cropped: ${JSON.stringify(r.crop)}`).toEqual([]);
    for (const b of r.hand) expect(b.bottom, 'hand card above the home indicator').toBeLessThanOrEqual(r.home + 0.5);
  }

  async branding() {
    expect(await this.page.title()).toBe('Lizard Wizard');
    expect(await this.page.evaluate(() => document.documentElement.outerHTML)).not.toMatch(/mandalorian/i);
  }

  async openMats() {
    const b = await this.page.getByTestId('board').boundingBox();
    await this.page.touchscreen.tap(b.x + b.width * 0.52, b.y + b.height * 0.486);
    await expect(this.page.getByTestId('mats')).toBeVisible();
    await this.page.waitForTimeout(400);
  }
  async closeTop(testid) { await this.page.getByTestId(testid).getByTestId('ov-close').first().tap(); await expect(this.page.getByTestId(testid)).toHaveCount(0); }

  // Every mat draws exactly the engine's wizards and towers (no ghost duplicates), with no overlaps, all reachable.
  async checkMats(shots = false) {
    await this.openMats();
    const m = await this.page.getByTestId('mats').evaluate(() => {
      const v = window.lwDebug.view(); const out = [];
      for (const p of v.players) {
        const mat = document.querySelector(`[data-testid=mat-${p.name}]`);
        const pairs = [...mat.querySelectorAll('.pair')].map((x) => [...x.querySelectorAll('.mcard img')].map((i) => i.getAttribute('src').replace(/^art\/cards\/|\.webp$/g, '')));
        const rs = [...mat.querySelectorAll('.mcard')].map((c) => c.getBoundingClientRect());
        let overlaps = 0;
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], c = rs[j]; if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) overlaps++; }
        const list = mat.querySelector(`[data-testid=mat-cards-${p.name}]`).dataset.wizards;
        out.push({ name: p.name, engineW: [...p.wizards].sort(), engineT: [...p.towers].sort(), drawnW: pairs.flat().filter((x) => x.startsWith('Wizard_')).sort(), drawnT: pairs.flat().filter((x) => x.startsWith('Tower_')).sort(),
          onePer: pairs.every((x) => x.filter((y) => y.startsWith('Wizard_')).length <= 1), overlaps, listed: list ? list.split(',').sort() : [] });
      }
      return out;
    });
    for (const p of m) {
      expect(p.drawnW, `${p.name}'s mat draws exactly the engine's wizards`).toEqual(p.engineW);
      expect(p.drawnT, `${p.name}'s mat draws exactly the engine's towers`).toEqual(p.engineT);
      expect(p.listed, `${p.name}'s card list = engine`).toEqual(p.engineW);
      expect(p.onePer && p.overlaps === 0, `${p.name}'s mat: one wizard per column, no overlaps`).toBe(true);
    }
    if (shots) await this.shot('mats-top');
    await this.checkOverlayCards('mats', '.mcard', 'mats');
    if (shots) {
      await this.page.getByTestId('mats').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const L = await this.limits();
      const last = await this.page.getByTestId('mats').locator('.mat').last().evaluate((e) => e.getBoundingClientRect().bottom);
      expect(last, 'the last mat scrolls above the Safari bar').toBeLessThanOrEqual(L.bottom + 0.5);
      await this.shot('mats-end');
    }
    this.lastWizards = m.find((p) => p.name === 'Keith').engineW.length;
    await this.closeTop('mats');
    return m;
  }

  // Card detail: the frame's top edge sits below the status bar and the close row; art whole; nothing covers the title.
  async checkCardDetail(label) {
    const ov = this.page.getByTestId('expanded').last();
    await expect(ov).toBeVisible();
    const imgEl = ov.getByTestId('expanded-img').first();
    if (await imgEl.count()) {
      await imgEl.evaluate((i) => i.decode().catch(() => {}));
    }
    await this.page.waitForTimeout(450);
    await ov.evaluate((el) => { el.scrollTop = 0; });
    const L = await this.limits();
    const m = await ov.getByTestId('expanded-card').first().evaluate((frame) => {
      const img = frame.querySelector('img');
      const f = frame.getBoundingClientRect();
      const close = frame.closest('.overlay').querySelector('[data-testid=ov-close]').getBoundingClientRect();
      if (!img) {
        const tile = frame.querySelector('[data-testid=achievement-tile]');
        return { kind: 'ach', f: f.top, fb: f.bottom, close: close.bottom, closeTop: close.top, th: tile ? tile.getBoundingClientRect().height : 0 };
      }
      const r = img.getBoundingClientRect();
      const probe = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.03);
      return {
        kind: 'card', f: f.top, fb: f.bottom, r: r.top, w: r.width, ratio: r.height / r.width, art: img.naturalHeight / img.naturalWidth,
        close: close.bottom, closeTop: close.top, titleOnTop: probe === img,
      };
    });
    expect(m.closeTop, `${label}: close button below the status bar`).toBeGreaterThanOrEqual(L.top);
    expect(m.f, `${label}: frame below the close row`).toBeGreaterThanOrEqual(m.close);
    if (m.kind === 'ach') {
      expect(m.th, `${label}: achievement tile has height`).toBeGreaterThan(40);
    } else {
      expect(m.r - m.f, `${label}: frame margin above the art`).toBeGreaterThanOrEqual(m.w * 0.05);
      expect(Math.abs(m.ratio / m.art - 1), `${label}: art whole`).toBeLessThan(0.01);
      expect(m.titleOnTop, `${label}: nothing covers the card title`).toBe(true);
    }
    expect(m.fb, `${label}: whole frame above the Safari bar`).toBeLessThanOrEqual(L.bottom + 0.5);
    await this.shot(label);
  }

  async checkMenu(label = 'menu') {
    await this.page.getByTestId('btn-menu').tap();
    await expect(this.page.getByTestId('menu')).toBeVisible();
    await this.page.waitForTimeout(350);
    const L = await this.limits();
    const menu = this.page.getByTestId('menu');
    await menu.evaluate((el) => { el.scrollTop = 0; });
    const head = await menu.evaluate((el) => { const t = el.querySelector('.sheet-panel .phase-title').getBoundingClientRect(); const c = el.querySelector('[data-testid=menu-close]').getBoundingClientRect(); return { title: t.top, close: c.top }; });
    expect(head.title, 'menu title below the status bar').toBeGreaterThanOrEqual(L.top);
    expect(head.close, 'menu close button below the status bar').toBeGreaterThanOrEqual(L.top);
    // every menu button can be scrolled fully between the status bar and the Safari bar
    const ids = await menu.locator('button.act').evaluateAll((bs) => bs.map((b) => b.dataset.testid));
    for (const id of ids) {
      const r = await menu.getByTestId(id).evaluate((b, top) => { const o = b.closest('.overlay'); o.scrollTop += b.getBoundingClientRect().top - top - 8; const x = b.getBoundingClientRect(); return [x.top, x.bottom]; }, L.top);
      expect(r[0], `${id} below the status bar`).toBeGreaterThanOrEqual(L.top - 0.5); expect(r[1], `${id} above the Safari bar`).toBeLessThanOrEqual(L.bottom + 0.5);
    }
    await menu.evaluate((el) => { el.scrollTop = 0; });
    await this.shot(label);
    await menu.getByTestId('menu-close').tap();
    await expect(menu).toHaveCount(0);
  }

  // ---------------------------------------------------------------- AI turns
  async aiPhase() {
    const page = this.page;
    this.aiSequences += 1;
    if (!this.cov.aiPaced) {
      if (!this.screens['ai-banner']) await this.shot('ai-banner');
      // watch the whole AI sequence hands-off (the shot above is not a tap), then measure every move shown since Keith acted
      await page.waitForFunction(() => { const v = window.lwDebug.view(); return !window.lwDebug.aiRunning() && (v.next === 'Keith' || v.auction || v.game_over); }, null, { timeout: 300_000 });
      await page.waitForTimeout(150);
      const log = (await page.evaluate(() => window.__bannerLog)).filter((x) => x.t >= (this.tKeith || 0));
      const full = log.slice(0, -1).map((x, i) => (x.cur ? log[i + 1].t - x.t : null)).filter((d) => d !== null);
      expect(full.length, 'at least one AI move measured at full pacing').toBeGreaterThan(0);
      for (const d of full) expect(d, `unskipped AI move on screen ${Math.round(d)} ms`).toBeGreaterThanOrEqual(4000);
      this.notes.push(`AI pacing measured: ${full.map(Math.round).join(', ')} ms per move`);
      this.mark('aiPaced');
      return;
    }
    const t0 = Date.now();
    await page.getByTestId('ai-skip').tap({ timeout: 2000 }).catch(() => {});
    if (!this.cov.aiSkip) {
      await page.waitForFunction(() => !window.lwDebug.aiRunning() || document.querySelector('[data-testid=arena]'), null, { timeout: 20_000 });
      const dt = Date.now() - t0;
      expect(dt, 'Skip finishes the AI moves at once').toBeLessThan(8000);
      this.notes.push(`Skip: AI sequence finished ${dt} ms after the tap`);
      this.mark('aiSkip');
    }
  }

  // ---------------------------------------------------------------- auctions
  async auctionStep() {
    const page = this.page;
    const live = await page.evaluate(() => !!document.querySelector('[data-testid=arena]:not(.out) [data-testid=bid-pass]:not([data-old]):not([disabled])'));
    if (!live) { await page.waitForTimeout(200); return; }
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => {
      const v = window.lwDebug.view(); const a = v.auction; const k = v.players.find((p) => p.name === 'Keith');
      const ar = document.querySelector('[data-testid=arena]:not(.out)');
      const val = ar.querySelector('[data-testid=bid-value]'); const go = ar.querySelector('[data-testid=bid-go]');
      return { mana: k.mana, a, min: val && +val.dataset.min, max: val && +val.dataset.max, manaText: ar.querySelector('[data-testid=bid-mana]')?.textContent,
        high: ar.querySelector('[data-testid=arena-high]').textContent, card: ar.querySelector('[data-testid=arena-card] img').getAttribute('src'),
        go: !!go && !go.disabled, arenas: document.querySelectorAll('[data-testid=arena]:not(.out)').length };
    });
    if (!st.a || st.a.waiting !== 'Keith') { await page.waitForTimeout(200); return; }
    expect(st.arenas, 'one auction screen').toBe(1);
    expect(st.card, 'arena shows the wizard being auctioned').toContain(st.a.card);
    expect(st.high).toContain(`High bid ${st.a.high} · ${st.a.who}`);
    expect(st.go, 'Bid enabled exactly when Keith can beat the high bid').toBe(st.mana > st.a.high);
    if (st.go) {
      expect(st.max, 'auction panel mana = engine mana').toBe(st.mana);
      expect(st.min).toBe(st.a.high + 1);
      expect(st.manaText).toContain(`Your mana: ${st.mana}`);
    }
    const id = `${st.a.card}|${st.a.starter}|${JSON.stringify(st.a.tail[0])}`;
    if (!this.auctionSeen.has(id)) {
      this.auctionSeen.add(id);
      await this.checkArenaLayout();
      if (!this.screens.arena) await this.shot('arena');
      // plan: win one (raise to all mana), then raise once and pass, then mostly pass
      this.auctionPlan = { id, raises: 0, mode: !this.cov.auctionWin ? 'win' : (!this.cov.auctionPass ? 'raise-then-pass' : 'pass'), card: st.a.card };
    }
    const plan = this.auctionPlan;
    const raise = st.go && (plan.mode === 'win' || (plan.mode === 'raise-then-pass' && plan.raises < 1));
    await page.evaluate(() => document.querySelectorAll('[data-testid=bid-pass], [data-testid=bid-go]').forEach((b) => { b.dataset.old = '1'; }));
    if (raise) { plan.raises += 1; if (plan.raises === 2) this.mark('auctionMultiRaise'); await page.getByTestId('bid-go').tap(); }
    else { if (plan.raises > 0 || plan.mode !== 'win') this.mark('auctionPass'); await page.getByTestId('bid-pass').tap(); }
  }

  async checkArenaLayout() {
    const L = await this.limits();
    await this.page.getByTestId('arena-card').locator('img').evaluate((i) => i.decode().catch(() => {}));
    const m = await this.page.getByTestId('arena').evaluate((ov) => {
      const r = (el) => el.getBoundingClientRect();
      const f = ov.querySelector('[data-testid=arena-card]'); const img = f.querySelector('img');
      const card = r(f); const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return { frameTop: card.top, imgTop: r(img).top, w: r(img).width, ratio: r(img).height / r(img).width, art: img.naturalHeight / img.naturalWidth,
        titleTop: r(ov.querySelector('.ov-title')).top, titleBottom: r(ov.querySelector('.ov-title')).bottom,
        overlap: [...ov.querySelectorAll('.seat')].filter((s) => hit(r(s), card)).length,
        btns: [...ov.querySelectorAll('[data-testid=bid-go], [data-testid=bid-pass]')].map((b) => r(b).bottom) };
    });
    expect(m.titleTop, 'auction title below the status bar').toBeGreaterThanOrEqual(L.top);
    expect(m.frameTop).toBeGreaterThanOrEqual(m.titleBottom);
    expect(m.imgTop - m.frameTop).toBeGreaterThanOrEqual(m.w * 0.05);
    expect(Math.abs(m.ratio / m.art - 1), 'auctioned card whole').toBeLessThan(0.01);
    expect(m.overlap, 'no seat over the auctioned card').toBe(0);
    for (const b of m.btns) expect(b, 'Pass / Bid above the Safari bar').toBeLessThanOrEqual(L.bottom + 0.5);
  }

  // ---------------------------------------------------------------- pending steps (Keith's spell effects, dungeon, New Research)
  async pendingStep(ovs) {
    const page = this.page;
    if (ovs.includes('effect')) {
      const kind = (await view(page)).pending?.kind;
      if (kind === 'scry') { await this.checkOverlayCards('effect', '.opt-card', 'scry picker'); if (!this.screens.picker) await this.shot('picker'); this.mark('scryPicker'); }
      else if (!this.screens[`effect-${kind}`]) await this.shot(`effect-${kind}`);
      if (await page.getByTestId('transmute-go').count()) {
        await page.getByTestId('transmute-0').tap(); await page.getByTestId('transmute-1').tap(); await page.getByTestId('transmute-go').tap();
      } else if (await page.locator('[data-testid^=swapo-their-]').count()) {
        await page.locator('[data-testid^=swapo-their-]').first().tap(); await page.locator('[data-testid^=swapo-mine-]').first().tap();
      } else await page.getByTestId('effect-options').locator('button').first().tap();
      await page.waitForTimeout(500);
      return;
    }
    if (ovs.includes('new-research')) {
      await this.checkOverlayCards('new-research', '.opt-card', 'New Research picker');
      if (!this.screens.picker) await this.shot('picker');
      this.mark('newResearch');
      await page.locator('[data-testid^=nr-]').first().tap();
      await page.waitForTimeout(500);
      return;
    }
    if (ovs.includes('dungeon')) {
      if (await page.getByTestId('dungeon-continue').count()) { await page.getByTestId('dungeon-continue').tap(); }
      else {
        const pd = (await view(page)).pending;
        if (pd && pd.type === 'dungeon' && !pd.done && pd.draws < 2 && pd.hits === 0) {
          await page.getByTestId('dungeon-deck').tap();
          await page.waitForFunction((d) => { const p = window.lwDebug.view().pending; return !p || p.draws > d; }, pd.draws, { timeout: 20_000 });
          if (!this.screens.dungeon) { await page.waitForTimeout(700); await this.checkOverlayCards('dungeon', '.dc', 'dungeon'); await this.shot('dungeon'); }
        } else if (await page.getByTestId('dungeon-stop').count()) await page.getByTestId('dungeon-stop').tap();
        else if (await page.getByTestId('dungeon-deck').count()) await page.getByTestId('dungeon-deck').tap();
      }
      await page.waitForTimeout(400);
      return;
    }
    await page.waitForTimeout(200);
  }

  // ---------------------------------------------------------------- Keith's actions (taps)
  // A keep tap must register (the icon turns on, or the last keep moves the sheet on); the icons sit over the card art,
  // so the art is decoded and laid out first.
  async tapKeep(i) {
    const page = this.page;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await page.evaluate(() => document.querySelector('[data-testid=keep-counter]')?.textContent || null);
      if (before === null) return;
      await page.getByTestId(`hot-gather-${i}`).tap();
      const ok = await page.waitForFunction(([b, idx]) => {
        const c = document.querySelector('[data-testid=keep-counter]');
        return !c || c.textContent !== b || document.querySelector(`[data-testid=hot-gather-${idx}]`)?.classList.contains('on');
      }, [before, i], { timeout: 2000 }).then(() => true).catch(() => false);
      if (ok) return;
      this.notes.push(`keep tap on icon ${i} did not register (attempt ${attempt + 1}); retried`);
    }
    throw new Error(`keep icon ${i} never registered`);
  }

  async gather(handIndex, g, keep, { unselect = false, cast = null, protect = [] } = {}) {
    const page = this.page;
    await page.getByTestId(`hand-${handIndex}`).tap();
    await expect(page.getByTestId('gather')).toBeVisible();
    await page.getByTestId('gather').locator('img').first().evaluate((im) => im.decode().catch(() => {}));
    await page.waitForFunction(() => document.querySelector('[data-testid=gather]')?.getAnimations({ subtree: true })
      .every((an) => an.playState !== 'running' || an.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {});
    const idx = keepIdx(g.offers, keep);
    if (unselect && idx.length >= 2) {
      await page.getByTestId(`hot-gather-${idx[0]}`).tap();
      await expect(page.getByTestId('keep-counter')).toHaveText(`1 / ${idx.length}`);
      await page.getByTestId(`hot-gather-${idx[0]}`).tap();                         // unselect
      await expect(page.getByTestId('keep-counter')).toHaveText(`0 / ${idx.length}`);
      this.mark('gatherUnselect');
    }
    for (const i of idx) await this.tapKeep(i);
    let phase = await gatherPhase(page); let cast2 = null; let returned = [];
    if (phase === 'cast') {
      if (cast && await page.getByTestId(`cast-${cast}`).isVisible()) {
        if (!this.screens['cast-glow']) await this.shot('cast-glow');
        await page.getByTestId(`cast-${cast}`).tap(); cast2 = cast;
      } else await page.getByTestId('skip-cast').tap();
      await expect(page.getByTestId('skip-cast')).toHaveCount(0);
      phase = await gatherPhase(page);
    }
    if (phase === 'putback') {
      if (!this.screens.putback) await this.shot('putback');
      returned = await tapPutbacks(page, protect);
      await expect(page.getByTestId('putback-pool')).toHaveCount(0, { timeout: 30_000 });
      phase = await gatherPhase(page);
    }
    expect(phase).toBe('done');
    return { cast: cast2, returned };
  }

  async keithTurn(v, db) {
    const page = this.page; const p = me(v); const L = v.legal; this.keithTurns += 1;
    const tapSlot = async (slot) => { await page.getByTestId(`slot-${slot}`).tap(); };
    const fixedResearch = Object.keys(L.research).filter((k) => !db[k].cost.variable && !L.research[k].x);
    const plainGather = async (opts = {}) => {
      const i = 0; const g = L.gather[p.hand[i]];
      return this.gather(i, g, g.keeps[0], { protect: opts.protect || [], ...opts });
    };

    if (this.keithTurns === 1) {
      // first look around: board, dock, mats (full scroll), card details, menu
      await this.branding();
      await this.checkBoardAndDock();
      await this.shot('board');
      await page.getByTestId('hand').scrollIntoViewIfNeeded();
      await this.shot('dock');
      await this.checkMats(true);
      await tapSlot('tower_face'); await this.checkCardDetail('card-tower'); await this.closeTop('expanded');
      await tapSlot('spell_0'); await this.checkCardDetail('card-spell'); await this.closeTop('expanded');
      await this.openMats();
      const wz = this.page.getByTestId('mats').locator('.mcard img[src*="Wizard_"]').first();
      if (await wz.count()) { await wz.tap(); await this.checkCardDetail('card-wizard'); await this.closeTop('expanded'); }
      await this.closeTop('mats');
      if (!this.screens['card-wizard'] && v.board.wiz_face[0] && !L.recruit.length) { await tapSlot('wiz_0'); await this.checkCardDetail('card-wizard'); await this.closeTop('expanded'); }
      await this.checkMenu();
    } else if (this.keithTurns % 6 === 0) {
      await this.checkBoardAndDock();
      await this.checkMats(false);
    }
    if (!this.screens['card-wizard'] && v.board.wiz_face.some(Boolean) && !L.recruit.length) {
      await tapSlot(`wiz_${v.board.wiz_face.findIndex(Boolean)}`); await this.checkCardDetail('card-wizard'); await this.closeTop('expanded');
    }

    // 1) gather with select / unselect
    if (!this.cov.gatherUnselect) {
      const i = p.hand.findIndex((hk) => (L.gather[hk]?.keeps?.[0]?.length || 0) >= 2);
      if (i >= 0) { const g = L.gather[p.hand[i]]; await this.gather(i, g, g.keeps[0], { unselect: true }); return; }
    }
    // 2) research only, then research & cast
    if (!this.cov.research && fixedResearch.length) {
      const sk = fixedResearch.sort((a, b) => L.research[a].mana - L.research[b].mana)[0];
      if (p.mana >= L.research[sk].mana + 5) {
        await tapSlot(`spell_${v.board.spell_face.indexOf(sk)}`);
        await page.getByTestId('research-only').tap();
        await page.waitForFunction((n) => window.lwDebug.view().players.find((q) => q.you).spells.length > n, p.spells.length, { timeout: 20_000 });
        this.mark('research'); return;
      }
    }
    const castNow = fixedResearch.filter((k) => L.research[k].castable);
    if (!this.cov.researchCast && castNow.length && p.mana >= L.research[castNow[0]].mana) {
      const sk = castNow[0];
      await tapSlot(`spell_${v.board.spell_face.indexOf(sk)}`);
      await page.getByTestId('research-cast').tap();
      await page.waitForFunction((n) => window.lwDebug.view().players.find((q) => q.you).spells.length > n, p.spells.length, { timeout: 20_000 });
      this.mark('researchCast'); return;
    }
    // 3) build (gold path when affordable and not yet seen, else reagents)
    if (L.build) {
      const pay = L.build.gold && !this.cov.buildGold ? 'gold' : (L.build.reagent ? 'reagent' : 'gold');
      await tapSlot('tower_face');
      await page.getByTestId(pay === 'gold' ? 'build-gold' : 'build-reagent').tap();
      await page.waitForFunction((n) => window.lwDebug.view().players.find((q) => q.you).towers.length > n, p.towers.length, { timeout: 20_000 });
      this.mark(pay === 'gold' ? 'buildGold' : 'buildReagent'); return;
    }
    // 4) summon: gather, then the dungeon, then New Research
    const fam = (use) => Object.entries(L.summon).filter(([, d]) => d.uses.includes(use) && d.cost <= p.mana).sort((a, b) => a[1].cost - b[1].cost)[0];
    for (const [goal, use, testid] of [['summon', 'gather', 'summon-gather'], ['dungeon', 'dungeon', 'summon-dungeon'], ['newResearch', 'research', 'summon-research']]) {
      const f = fam(use);
      if (this.cov[goal] || !f) continue;
      await tapSlot(`fam_${v.board.fam_face.indexOf(f[0])}`);
      await page.getByTestId(testid).tap();
      if (use === 'gather') {
        let ph = await gatherPhase(page);
        if (ph === 'cast') { await page.getByTestId('skip-cast').tap(); await expect(page.getByTestId('skip-cast')).toHaveCount(0); ph = await gatherPhase(page); }
        if (ph === 'putback') { await tapPutbacks(page, []); await expect(page.getByTestId('putback-pool')).toHaveCount(0, { timeout: 30_000 }); ph = await gatherPhase(page); }
        expect(ph).toBe('done');
      }
      if (use !== 'research') this.mark(goal);
      return;
    }
    // 5) gather + cast an owned spell + put back (the cast glow)
    if (!this.cov.gatherCastPutback) {
      let plan = null;
      for (const s of p.spells.filter((x) => x.key && !x.cast && !db[x.key].cost.variable)) {
        const cost = costList(db[s.key]);
        p.hand.forEach((hk, i) => {
          const g = L.gather[hk];
          for (const keep of g?.keeps || []) {
            if (plan) return;
            const hold = cnt([...p.tok, ...keep, ...g.bonus]);
            if (covers(hold, cost) && p.tok.length + keep.length + g.bonus.length - cost.length > p.cap) plan = { spell: s.key, i, keep, g };
          }
        });
      }
      if (plan) {
        const r = await this.gather(plan.i, plan.g, plan.keep, { cast: plan.spell });
        if (r.cast && r.returned.length) this.mark('gatherCastPutback');
        return;
      }
    }
    // 6) convert one reagent type into mana
    if (!this.cov.convert && Object.keys(L.convert).length && p.tok.length >= 3) {
      const [r] = Object.entries(L.convert).sort((a, b) => b[1].n * b[1].value - a[1].n * a[1].value)[0];
      await page.getByTestId(`token-${r}`).tap();
      await page.getByTestId('convert-go').tap();
      await page.waitForFunction((m) => window.lwDebug.view().players.find((q) => q.you).mana > m, p.mana, { timeout: 20_000 });
      this.mark('convert'); return;
    }
    // 7) open an auction (Keith starts it at 1; the arena loop then answers raises)
    const wantWizard = !this.cov.auctionOpen || (!this.cov.auctionWin && p.mana >= 25) || (p.mana >= 40 && this.keithTurns % 3 === 0);
    if (wantWizard && L.recruit.length && p.mana >= 5) {
      const wz = L.recruit[0];
      await tapSlot(`wiz_${v.board.wiz_face.indexOf(wz)}`);
      await expect(page.getByTestId('bid-go')).toBeVisible();
      await page.waitForTimeout(500);                                    // past the board's ghost-click guard
      await this.checkArenaLayout().catch(() => {});
      const st = await page.getByTestId('bid-mana').textContent();
      expect(st).toContain(`Your mana: ${p.mana}`);
      await page.getByTestId('bid-go').tap();
      this.mark('auctionOpen');
      await page.waitForFunction(() => !document.querySelector('[data-testid=bid-cancel]'), null, { timeout: 20_000 });
      return;
    }
    // 8) otherwise: convert when storage is full and mana is low, else a plain gather
    if (p.tok.length >= p.cap && p.mana < 10 && Object.keys(L.convert).length) {
      const [r] = Object.entries(L.convert).sort((a, b) => b[1].n * b[1].value - a[1].n * a[1].value)[0];
      await page.getByTestId(`token-${r}`).tap(); await page.getByTestId('convert-go').tap();
      await page.waitForFunction((m) => window.lwDebug.view().players.find((q) => q.you).mana > m, p.mana, { timeout: 20_000 });
      this.mark('convert'); return;
    }
    const keepFor = L.build ? [] : [];
    await plainGather({ protect: keepFor });
  }

  // ---------------------------------------------------------------- the game loop
  async play(db) {
    const page = this.page;
    for (let step = 0; step < 4000; step++) {
      const s = await page.evaluate(() => ({ v: window.lwDebug.view(), ai: window.lwDebug.aiRunning(), banner: !!document.querySelector('#banner-layer .banner:not(.out)'),
        ov: [...document.querySelectorAll('#overlays .overlay:not(.out)')].map((o) => o.dataset.testid) }));
      if (s.v.game_over) return s.v;
      if (s.ov.includes('arena')) { await this.auctionStep(); continue; }
      if (s.ov.some((o) => ['effect', 'new-research', 'dungeon'].includes(o))) { await this.pendingStep(s.ov); continue; }
      if (s.banner && s.ai) { await this.aiPhase(); continue; }
      const keith = !s.ai && s.ov.length === 0 && s.v.next === 'Keith' && !s.v.auction && !s.v.pending && s.v.legal;
      if (keith) {
        const k = me(s.v);
        const won = (await page.evaluate(() => window.lwDebug.log())).filter((e) => e.act === 'auction' && e.who === 'Keith').length;
        if (won > (this.wonSeen || 0)) { this.mark('auctionWin'); this.wonSeen = won; }
        if (this.lastWizards !== null && k.wizards.length !== this.lastWizards) await this.checkMats(false);   // every wizard change is checked against the engine
        if (this.lastWizards === null) this.lastWizards = k.wizards.length;
        expect(this.keithTurns, 'the game ends within 80 of Keith\'s turns').toBeLessThan(80);
        await this.keithTurn(s.v, db);
        this.tKeith = await page.evaluate(() => performance.now());
        await page.waitForTimeout(250);
        continue;
      }
      await page.waitForTimeout(150);
    }
    throw new Error('the game did not finish');
  }

  async endGame(v) {
    const page = this.page;
    await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 30_000 });
    const ranks = Object.entries(v.final).sort((a, b) => b[1] - a[1]);
    for (const [n, pts] of ranks) await expect(page.getByTestId('game-over').getByTestId(`final-${n}`)).toContainText(`${pts} VP`);
    await this.shot('game-over');
    this.mark('gameOver');
    await page.getByTestId('go-close').tap();
    await expect(page.getByTestId('game-over')).toHaveCount(0);
    await expect(page.getByTestId('dock-scores')).toBeVisible();
    await this.checkMats(false);
    await this.checkMenu('menu-final-scores');
    await page.getByTestId('go-play-again').tap();
    await expect(page.getByTestId('new-game-hand').locator('img')).toHaveCount(3);
    await page.getByTestId('pick-Sulphur').tap(); await page.getByTestId('pick-Toadstool').tap();
    await page.getByTestId('new-game-start').tap();
    await page.waitForFunction(() => { const x = window.lwDebug.view(); return x.round === 1 && !x.game_over; }, null, { timeout: 30_000 });
    await this.shot('play-again-round-1');
    this.mark('playAgain');
    await this.branding();
  }
}

test.describe.configure({ mode: 'serial' });

for (const run of RUNS) {
  test(`playtest ${run.id}: a full game by taps, every major screen checked`, async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const errors = watchErrors(page);
    if (process.env.PLAYTEST_DEBUG) page.on('console', (m) => { if (m.type() !== 'info' && m.type() !== 'log') console.log('PAGE', m.type(), m.text().slice(0, 400)); });
    if (process.env.PLAYTEST_DEBUG) page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    if (run === RUNS[0]) fs.rmSync(`docs/screenshots/playtest/${projectName()}`, { recursive: true, force: true });
    await page.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1'); } }, G8_AUTO);
    await page.addInitScript(() => {
      window.__bannerLog = []; let last = null;
      setInterval(() => {
        const el = document.querySelector('#banner-layer .banner:not(.out)');
        const cur = el ? `${el.dataset.move}|${el.querySelector('[data-testid=ai-banner-text]')?.textContent}` : null;
        if (cur !== last) { window.__bannerLog.push({ t: performance.now(), cur }); last = cur; }
      }, 25);
    });
    await page.goto('/');
    await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
    await page.addStyleTag({ content: `:root { --safe-t: ${INSET.top}px !important; --safe-b: ${INSET.bottom}px !important; --chrome-b: ${INSET.chrome}px !important; }` });
    const pt = new Playtest(page, run);
    const db = await cards(page);
    if (run.from === 'new') {
      await page.evaluate((s) => window.lwDebug.seedNextGame(s), run.seeds);
      await page.getByTestId('btn-menu').tap();
      await page.getByTestId('menu-new-game').tap();
      await page.getByTestId('setup-quick-start').tap();
      await expect(page.getByTestId('new-game-hand').locator('img')).toHaveCount(3);
      await pt.shot('new-game');
      await page.getByTestId('pick-Horn').tap(); await page.getByTestId('pick-Mandrake').tap();
      await page.getByTestId('new-game-start').tap();
      await page.waitForFunction(() => window.lwDebug.view().round === 1, null, { timeout: 30_000 });
      await page.evaluate(() => window.lwDebug.seedNextGame(null));
    }
    const t0 = Date.now();
    const v = await pt.play(db);
    const lg = await page.evaluate(() => window.lwDebug.log());
    await pt.endGame(v);
    const summary = { run: run.id, project: projectName(), rounds: v.round, keithTurns: pt.keithTurns, aiSequences: pt.aiSequences, minutes: +((Date.now() - t0) / 60000).toFixed(1),
      final: v.final, coverage: pt.cov, screens: Object.keys(pt.screens), notes: pt.notes,
      keithWonAuctions: lg.filter((e) => e.act === 'auction' && e.who === 'Keith').length, auctions: lg.filter((e) => e.act === 'auction').length };
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(`test-results/playtest-${projectName()}-${run.id}.json`, JSON.stringify(summary, null, 1));
    console.log(`PLAYTEST ${run.id} (${projectName()}): ${JSON.stringify(summary)}`);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('playtest coverage: the three games together exercised every mechanic and every major screen', async () => {
  const runs = RUNS.map((r) => JSON.parse(fs.readFileSync(`test-results/playtest-${projectName()}-${r.id}.json`, 'utf8')));
  const cov = {}; runs.forEach((r) => Object.entries(r.coverage).forEach(([k, n]) => { cov[k] = (cov[k] || 0) + n; }));
  const screens = new Set(runs.flatMap((r) => r.screens));
  const missing = MECHANICS.filter((k) => !cov[k]);
  const missingScreens = SCREENS.filter((s) => !screens.has(s));
  const summary = { project: projectName(), runs: runs.map((r) => ({ run: r.run, rounds: r.rounds, keithTurns: r.keithTurns, minutes: r.minutes, final: r.final, keithWonAuctions: r.keithWonAuctions })),
    coverage: cov, optionalMissing: OPTIONAL.filter((k) => !cov[k]), screens: [...screens] };
  fs.writeFileSync(`test-results/playtest-${projectName()}-summary.json`, JSON.stringify(summary, null, 1));
  console.log(`PLAYTEST SUMMARY (${projectName()}): ${JSON.stringify(summary)}`);
  expect(missing, `mechanics never exercised: ${missing}`).toEqual([]);
  expect(missingScreens, `screens never captured: ${missingScreens}`).toEqual([]);
});
