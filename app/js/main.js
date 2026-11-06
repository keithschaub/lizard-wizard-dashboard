import { Engine } from './engine.js';
import { Board } from './board.js';
import { h, art, reagentIcon, nice, counts, sleep } from './dom.js';
import * as UI from './ui.js';
import * as Audio from './audio.js';
import * as Store from './store.js';

const T_START = performance.now();
const ME = 'Keith';
const MUTE_ON = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const MUTE_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

class Game {
  constructor() {
    this.me = ME; this.v = null; this.cards = {}; this.skip = false; this.moveQueue = []; this.settling = false; this.busy = false;
    this.engine = null;
    this.board = new Board(document.getElementById('stage'), document.getElementById('board'), (el) => this.onBoardTap(el));
    this.dock = document.getElementById('dock');
    document.getElementById('btn-log').onclick = () => { this.sfx('tap'); UI.openLog(this); };
    document.getElementById('btn-menu').onclick = () => { this.sfx('tap'); UI.menu(this); };
    const mute = document.getElementById('btn-mute');
    const paintMute = () => { mute.innerHTML = Audio.isMuted() ? MUTE_ON : MUTE_OFF; mute.setAttribute('aria-pressed', Audio.isMuted() ? 'true' : 'false'); };
    mute.onclick = () => { Audio.setMuted(!Audio.isMuted()); paintMute(); this.sfx('select'); };
    paintMute();
    window.addEventListener('pointerdown', () => { Audio.unlock(); if (this.aiRunning) this.skipMove = true; }, { capture: true });
    window.lwDebug = { seedNextGame: (seeds) => { this.nextGameSeeds = seeds; }, view: () => JSON.parse(JSON.stringify(this.v)), cards: () => this.cards, log: () => this.call('full_log').then((r) => r.result), loadMs: () => this.loadMs, ready: () => !!this.ready, aiRunning: () => !!this.aiRunning };
  }

  me_() { return this.v.players.find((p) => p.name === this.me); }
  sfx(n) { Audio.play(n); }
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), 2600);
  }
  call(fn, args) { return this.engine.call(fn, args); }

  // ---------------------------------------------------------------- loading (splash, watchdog, errors, retry)
  startEngine() {
    this.engine?.terminate();
    this.loadState = { t0: Date.now(), last: Date.now(), stage: 'starting', text: '', error: null };
    this.engine = new Engine(
      (m) => { Object.assign(this.loadState, { last: Date.now(), stage: m.stage, text: m.text }); this.splash(m.text); },
      (error, stage) => { if (!this.ready && stage !== 'retry') this.loadFailed(error, stage); },
    );
  }

  splash(text, { error = null, hint = null, retry = false } = {}) {
    document.getElementById('loader-status').textContent = text;
    const err = document.getElementById('loader-error');
    err.classList.toggle('hidden', !error && !hint && !retry);
    document.getElementById('loader-error-text').textContent = error || '';
    document.getElementById('loader-error-text').classList.toggle('hidden', !error);
    document.getElementById('loader-hint').textContent = hint || '';
    document.getElementById('loader-details').textContent = error ? this.loadDetails() : '';
    document.getElementById('loader-retry').classList.toggle('hidden', !retry);
  }

  loadDetails() {
    const L = this.loadState || {};
    return `stage: ${L.stage} · ${Math.round((Date.now() - (L.t0 || Date.now())) / 1000)} s · ${navigator.userAgent}`;
  }

  loadFailed(error, stage) {
    if (this.ready || this.loadState?.error) return;
    this.loadState.error = error; this.loadState.stage = stage || this.loadState.stage;
    clearInterval(this.watchdog);
    document.getElementById('loader').classList.add('failed');
    this.splash('The game could not start.', { error, retry: true, hint: 'Check the connection and tap Retry. If it keeps failing, send a screenshot of this message.' });
  }

  watch() {
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      const L = this.loadState;
      if (this.ready || L.error) { clearInterval(this.watchdog); return; }
      const total = (Date.now() - L.t0) / 1000; const idle = (Date.now() - L.last) / 1000;
      if (idle >= 45) this.splash(L.text, { hint: `No progress for ${Math.round(idle)} s while ${L.stage === 'compile' ? 'compiling the Python runtime' : L.text.replace(/….*$/, '').toLowerCase()}. It may still finish; tap Retry to start over.`, retry: true });
      else if (total >= 60) this.splash(L.text, { hint: `Still loading after ${Math.round(total)} s (${L.stage}). Slow networks and phones without WebAssembly JIT (e.g. Lockdown Mode) can take longer; tap Retry to start over.`, retry: true });
    }, 1000);
  }

  async retry() {
    this.sfx('tap');
    document.getElementById('loader').classList.remove('failed');
    this.splash('Opening the spellbook…');
    await this.boot();
  }

  async boot() {
    this.startEngine();
    this.watch();
    try {
      await this.engine.init({ maxTouchPoints: navigator.maxTouchPoints, userAgent: navigator.userAgent });
      const db = await this.call('card_db');
      if (!db.ok) throw new Error(db.error);
      this.cards = db.result;
      let text = Store.loadLocal(); let r = null;
      if (text) { r = await this.call('load', { text }); if (!r.ok) { console.warn('saved game unreadable, starting g8:', r.error); text = null; } }
      if (!text) {
        const resp = await fetch('engine/game/g8_state.json');
        if (!resp.ok) throw new Error(`engine/game/g8_state.json: HTTP ${resp.status}`);
        text = await resp.text();
        r = await this.call('load', { text });
        if (!r.ok) throw new Error(r.error);
        Store.saveLocal(text);
      }
      this.setView(r.result);
      this.loadMs = Math.round(performance.now() - T_START);
      clearInterval(this.watchdog);
      document.getElementById('loader').classList.add('done');
      document.body.dataset.ready = '1';
      this.ready = true;
      this.settle();
    } catch (e) {
      this.loadFailed(e.message || String(e), e.stage);
    }
  }

  async act(fn, args, { sound = null } = {}) {
    const r = await this.call(fn, args);
    if (!r.ok) { this.sfx('error'); this.toast(r.error); return null; }
    if (sound) this.sfx(sound);
    if (r.view) this.setView(r.view);
    this.queueMoves(r.entries);
    await this.autosave();
    return r;
  }

  // AI moves the engine made inside one of Keith's calls (after an auction it plays the AI turns that follow).
  // They are announced by settle() before anything else; auction results are shown by the arena itself.
  queueMoves(entries) {
    const shown = new Set(['turn', 'reshuffle_reagents', 'auction', 'auction_nobid', 'game_over']);
    this.moveQueue.push(...(entries || []).filter((e) => e.who && e.who !== this.me && !shown.has(e.act)));
  }
  async autosave() { const d = await this.call('dump'); if (d.ok) Store.saveLocal(d.result); }

  afterAction() { this.settle(); }

  setView(v) {
    const prev = this.v; this.v = v;
    this.board.render(v);
    this.renderDock(prev);
    this.renderTop();
  }

  renderTop() {
    const v = this.v;
    document.querySelector('[data-testid=round]').textContent = v.game_over ? 'Game over' : `Round ${v.round}`;
    const t = document.querySelector('[data-testid=turn]');
    let txt; let you = false;
    if (v.game_over) txt = UI.ranking(v).text;
    else if (v.auction) txt = v.auction.waiting === this.me ? 'Your bid' : `Auction · ${v.auction.waiting || ''}`;
    else if (v.next === this.me) { txt = v.bonus || v.again ? 'Your turn · bonus action' : 'Your turn'; you = true; }
    else txt = `${v.next}'s turn`;
    t.textContent = txt; t.classList.toggle('you', you);
  }

  renderDock(prev) {
    const v = this.v; const p = this.me_(); const L = v.legal || {};
    const prevHand = prev ? prev.players.find((q) => q.name === this.me).hand : p.hand;
    const tok = counts(p.tok);
    const status = v.game_over ? `Game over · ${UI.ranking(v).text}` : (v.next === this.me && !v.auction ? (v.pending ? 'Finish your move' : 'Your move') : (this.aiRunning ? `${v.next} is playing…` : `${v.next}'s turn`));
    this.dock.innerHTML = '';
    this.dock.dataset.mana = p.mana; this.dock.dataset.gold = p.gold; this.dock.dataset.tokens = p.tok.length; this.dock.dataset.vp = p.vp;
    this.dock.append(
      h('div', { class: 'dock-stats' },
        h('span', { class: 'stat mana', 'data-testid': 'my-mana', title: 'Mana' }, h('span', { class: 'orb' }), p.mana),
        h('span', { class: 'stat gold', 'data-testid': 'my-gold', title: 'Gold' }, h('span', { class: 'orb' }), p.gold),
        h('span', { class: 'stat vp', 'data-testid': 'my-vp' }, `${p.vp} VP`),
        h('span', { class: `stat store ${p.tok.length > p.cap ? 'full' : ''}`, 'data-testid': 'my-storage' }, `${p.tok.length}/${p.cap}`),
        v.game_over ? h('button', { class: 'dock-btn', 'data-testid': 'dock-scores', onclick: () => { this.sfx('tap'); UI.gameOver(this); } }, 'Scores') : null,
        h('span', { class: `dock-status ${v.next === this.me && !v.game_over ? 'you' : ''}`, 'data-testid': 'dock-status' }, status)),
      h('div', { class: 'dock-main' },
        h('div', { class: 'tokens', 'data-testid': 'tokens' }, tok.size ? [...tok].map(([r, n]) => {
          const legal = !!(L.convert || {})[r];
          const el = h('button', { class: `tokchip ${legal ? 'legal' : ''}`, 'data-testid': `token-${r}`, 'aria-label': `${n} ${nice(r)}` }, h('img', { src: reagentIcon(r), alt: '' }), `×${n}`);
          el.onclick = () => { this.sfx('tap'); if (legal) UI.convertSheet(this, r); else this.toast(`${nice(r)}: track value ${v.board.tracks[r]}`); };
          return el;
        }) : h('div', { class: 'empty-note' }, 'No reagent tokens')),
        h('div', { class: 'hand', 'data-testid': 'hand' }, p.hand.map((k, i) => {
          const legal = !!(L.gather || {})[k];
          let cardStyle = null;
          if (p.hand.length > 3) {
            const availWidth = 370;
            const gap = 8;
            const totalGaps = (p.hand.length - 1) * gap;
            const cardWidth = Math.floor((availWidth - totalGaps) / p.hand.length);
            const cardHeight = Math.floor(cardWidth * 1.39);
            cardStyle = { width: `${cardWidth}px`, height: `${cardHeight}px` };
          }
          const el = h('div', { class: `hcard ${legal ? 'legal' : ''} ${prevHand && !prevHand.includes(k) ? 'deal' : ''}`, 'data-testid': `hand-${i}`, 'data-key': k, style: cardStyle },
            h('img', { src: art(k), alt: k, draggable: 'false' }));
          el.onclick = () => { this.sfx('tap'); if (legal && !this.busyFlow()) UI.gatherFlow(this, k); else UI.expandCard(this, k); };
          return el;
        }))));
  }

  busyFlow() { return !!document.querySelector('#overlays .overlay:not(.out)'); }

  onBoardTap(el) {
    if (this.aiRunning) return;
    if (!el) { this.sfx('tap'); UI.openMats(this); return; }
    const v = this.v; const L = v.legal || {};
    const slot = el.dataset.slot; const key = el.dataset.key;
    this.sfx('tap');
    if (el.dataset.tap === 'ach') { UI.expandCard(this, key); return; }
    if (el.dataset.tap === 'deck') {
      if (slot === 'dungeon_deck' && L.divination) { UI.divinationFlow(this); return; }
      UI.openMats(this); return;
    }
    if (slot === 'tower_face' && L.build) return UI.buildFlow(this);
    if (slot?.startsWith('wiz_') && (L.recruit || []).includes(key)) return UI.arena(this, { mode: 'open', wizard: key }).then(() => this.settle());
    if (slot?.startsWith('fam_') && (L.summon || {})[key]) return UI.summonFlow(this, key);
    if (slot?.startsWith('spell_') && (L.research || {})[key]) return UI.researchFlow(this, key);
    UI.expandCard(this, key);
  }

  async settle() {
    if (this.settling) return;
    this.settling = true;
    try {
      for (let guard = 0; guard < 200; guard++) {
        if (this.moveQueue.length) { await this.playMoves(this.moveQueue.splice(0)); continue; }
        const v = this.v;
        if (v.game_over) {
          const k = `${v.round}:${JSON.stringify(v.final)}`;
          if (this.overShown !== k) { this.overShown = k; UI.gameOver(this); }
          return;
        }
        if (v.pending) {
          if (v.pending.type === 'dungeon') await UI.dungeonFlow(this);
          else if (v.pending.type === 'new_research') await UI.newResearchChooser(this);
          else if (v.pending.type === 'rise') await UI.riseUseChooser(this);
          else await UI.effectChooser(this);
          continue;
        }
        if (v.auction && v.auction.waiting === this.me) { await UI.arena(this, { mode: 'respond' }); continue; }
        if (v.next !== this.me) { if (!(await this.aiStep())) return; continue; }
        if (this.lastTurnRound !== `${v.round}:${v.log_len}`) { this.lastTurnRound = `${v.round}:${v.log_len}`; this.sfx('turn'); }
        return;
      }
    } finally { this.settling = false; this.renderDock(this.v); }
  }

  async aiStep() {
    this.aiRunning = true; this.renderDock(this.v);
    try {
      const r = await this.call('ai_step');
      if (!r.ok) { this.toast(r.error); return false; }
      const res = r.result;
      await this.showMoves(res.entries.filter((e) => e.act !== 'turn' && e.act !== 'reshuffle_reagents'));
      const vr = await this.call('view');
      this.setView(vr.result);
      await UI.bannerDone(this);
      await this.autosave();
      if (this.v.next === this.me || this.v.auction || this.v.game_over) this.skip = false;
      return res.status !== 'human' && res.status !== 'over';
    } finally { this.aiRunning = false; }
  }

  async showMoves(moves) {
    for (const [i, e] of moves.entries()) {
      const slot = this.slotFor(e);
      if (slot && !this.skip) this.board.focus(slot);
      if (!this.skip) this.sfx(e.cast ? 'cast' : e.act === 'build' ? 'build' : e.act === 'dungeon' ? 'flip' : e.act === 'gather' ? 'gather' : 'tap');
      const run = moves.filter((x) => x.who === e.who);
      await UI.banner(this, e, run.indexOf(e), run.length);
      this.board.focus(null);
    }
  }

  async playMoves(moves) {
    this.aiRunning = true; this.renderDock(this.v);
    try { await this.showMoves(moves); await UI.bannerDone(this); }
    finally { this.aiRunning = false; if (this.v.next === this.me || this.v.auction) this.skip = false; }
  }

  slotFor(e) {
    const b = this.v.board;
    if (e.act === 'build') return 'tower_face';
    const find = (arr, prefix, k) => { const i = arr.indexOf(k); return i >= 0 ? `${prefix}_${i}` : null; };
    if (e.act === 'research') return find(b.spell_face, 'spell', (e.cards || [])[0]);
    if (e.act === 'summon') return find(b.fam_face, 'fam', (e.cards || [])[0]);
    if (e.act === 'auction') return find(b.wiz_face, 'wiz', (e.cards || [])[0]);
    if (e.act === 'dungeon') return 'dungeon_deck';
    return null;
  }

  savedNote() { const at = Store.savedAt(); return at ? `Autosaved ${new Date(at).toLocaleString()}` : 'Not saved yet'; }
  async exportSave() { const d = await this.call('dump'); if (d.ok) Store.exportFile(d.result, this.v.round); }
  async importSave() {
    const text = await Store.pickFile(); if (!text) return;
    const r = await this.call('load', { text });
    if (!r.ok) { this.toast(`Not a valid save: ${r.error}`); return; }
    Store.saveLocal(text); UI.closeAll(); this.setView(r.result); this.toast('Save loaded'); this.settle();
  }
  async startedNewGame(view) {
    this.overShown = null; this.lastTurnRound = null;
    this.setView(view);
    await this.autosave();
    this.toast('New game: round 1, your move');
    this.settle();
  }

  async restart() {
    const text = await (await fetch('engine/game/g8_state.json')).text();
    const r = await this.call('load', { text });
    if (r.ok) { this.overShown = null; Store.saveLocal(text); UI.closeAll(); this.setView(r.result); this.toast('Game g8 restored'); this.settle(); }
  }
}

// The tab title is always the app's own name (another app on the same github.io host must not rename it).
const TITLE = 'Lizard Wizard';
document.title = TITLE;
new MutationObserver(() => { if (document.title !== TITLE) document.title = TITLE; })
  .observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true });

const game = new Game();
document.getElementById('loader-retry').addEventListener('click', () => game.retry());
game.boot();
