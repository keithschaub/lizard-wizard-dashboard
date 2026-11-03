import { h, art, reagentIcon, schoolIcon, REAGENTS, SCHOOL_REAGENT } from './dom.js';

export const BW = 864, BH = 1152;
// Slot positions in board units (864 x 1152), identical to the engine's own board renderer (scripts/render4.py).
export const SLOTS = {
  tower_deck: [40, 384], tower_face: [154, 384],
  wiz_deck: [500, 384], wiz_0: [614, 384], wiz_1: [728, 384],
  fam_deck: [24, 578], fam_0: [138, 578], fam_1: [252, 578],
  spell_deck: [500, 778], spell_0: [614, 620], spell_1: [728, 620], spell_2: [614, 778], spell_3: [728, 778],
  dungeon_deck: [40, 900],
};
const DECKS = { tower_deck: ['Towers', ''], wiz_deck: ['Wizards', ''], fam_deck: ['Familiars', ''], spell_deck: ['Spells', 'spells'], dungeon_deck: ['Dungeon', 'dungeon'] };
const SCHOOLS = Object.keys(SCHOOL_REAGENT);

function achSchool(t) {
  for (const sc of SCHOOLS) if (t.toLowerCase().includes(sc.toLowerCase())) return sc;
  for (const [sc, r] of Object.entries(SCHOOL_REAGENT)) if (t.replaceAll('_', ' ').toLowerCase().includes(r.replaceAll('_', ' ').toLowerCase())) return sc;
  return null;
}

export class Board {
  constructor(stage, el, onTap) {
    this.stage = stage; this.el = el; this.onTap = onTap;
    this.slots = {}; this.markers = {}; this.keys = {};
    el.appendChild(h('img', { class: 'board-bg', src: 'art/board/game_board_clean.webp', alt: '', draggable: 'false' }));
    for (const [name, [x, y]] of Object.entries(SLOTS)) {
      const s = h('div', { class: 'slot-holder', style: { position: 'absolute', left: `${x}px`, top: `${y}px`, width: '104px', height: '145px' } });
      this.slots[name] = s; el.appendChild(s);
    }
    REAGENTS.forEach((r, i) => {
      const m = h('div', { class: 'marker', 'data-testid': `track-${r}`, style: { left: `${24 + i * 96 + 26 - 9.5}px`, top: `${324 - 9.5}px` } }, h('img', { src: reagentIcon(r), alt: '' }));
      this.markers[r] = m; el.appendChild(m);
    });
    this.achLayer = h('div', { class: 'ach-layer' }); el.appendChild(this.achLayer);
    this.pz = new PanZoom(stage, el, onTap);
  }

  slotRect(name) { return this.slots[name]?.getBoundingClientRect(); }

  render(v) {
    const b = v.board; const L = v.legal || {};
    const want = {
      tower_deck: ['deck', b.tower_deck], tower_face: b.tower_face,
      wiz_deck: ['deck', b.wiz_deck], wiz_0: b.wiz_face[0], wiz_1: b.wiz_face[1],
      fam_deck: ['deck', b.fam_deck], fam_0: b.fam_face[0], fam_1: b.fam_face[1],
      spell_deck: ['deck', b.spell_deck], spell_0: b.spell_face[0], spell_1: b.spell_face[1], spell_2: b.spell_face[2], spell_3: b.spell_face[3],
      dungeon_deck: ['deck', b.dungeon_deck],
    };
    for (const [name, k] of Object.entries(want)) {
      const holder = this.slots[name];
      const sig = JSON.stringify(k ?? null);
      if (this.keys[name] !== sig) {
        const first = this.keys[name] === undefined;
        this.keys[name] = sig; holder.innerHTML = '';
        if (Array.isArray(k)) {
          const [label, cls] = DECKS[name];
          holder.appendChild(h('div', { class: `deck ${cls} ${k[1] ? '' : 'empty'}`, 'data-tap': 'deck', 'data-slot': name, 'data-testid': `slot-${name}`, style: { left: 0, top: 0 } },
            h('div', { class: 'mono' }, 'LW'), h('div', { class: 'dname' }, label), h('div', { class: 'dcount' }, `${k[1]} cards`)));
        } else if (k) {
          holder.appendChild(h('div', { class: `bcard ${first ? '' : 'deal'}`, 'data-tap': 'card', 'data-key': k, 'data-slot': name, 'data-testid': `slot-${name}`, style: { left: 0, top: 0 } },
            h('img', { src: art(k), alt: k, draggable: 'false' })));
        }
      }
      const node = holder.firstChild;
      if (node) {
        let legal = false;
        if (name === 'tower_face') legal = !!L.build;
        else if (name.startsWith('wiz_') && name !== 'wiz_deck') legal = (L.recruit || []).includes(k);
        else if (name.startsWith('fam_') && name !== 'fam_deck') legal = !!(L.summon || {})[k];
        else if (name.startsWith('spell_') && name !== 'spell_deck') legal = !!(L.research || {})[k];
        else if (name === 'dungeon_deck') legal = !!L.divination;
        node.classList.toggle('legal', legal);
      }
    }
    for (const r of REAGENTS) {
      const val = Math.max(1, Math.min(12, b.tracks[r] || 1));
      const top = `${324 - (val - 1) * 20.2 - 9.5}px`;
      const m = this.markers[r];
      if (m.style.top !== top) {
        const had = m.dataset.v !== undefined;
        m.style.top = top; m.dataset.v = val;
        if (had) { m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); }
      }
    }
    const achSig = JSON.stringify(b.ach);
    if (this.achSig !== achSig) {
      this.achSig = achSig; this.achLayer.innerHTML = '';
      b.ach.forEach((t, k) => {
        const sc = achSchool(t);
        let main, sub;
        if (t.startsWith('x7 ')) { main = [h('span', {}, '7'), h('img', { src: reagentIcon(t.slice(3)), alt: '' })]; sub = 'Reagents'; }
        else {
          const [num, ...rest] = t.split(' ');
          main = [sc ? h('img', { src: schoolIcon(sc), alt: '' }) : null, h('span', {}, num)];
          sub = rest.join(' ').replace(' cards', ' Cards');
        }
        this.achLayer.appendChild(h('div', { class: 'ach', 'data-tap': 'ach', 'data-key': `Achievement:${t}`, 'data-testid': `ach-${k}`, style: { left: '722px', top: `${50 + k * 72}px` } },
          h('div', { class: 'a-h' }, 'ACHIEVEMENT'), h('div', { class: 'a-vp' }, '10'), h('div', { class: 'a-main' }, main), h('div', { class: 'a-sub' }, sub)));
      });
    }
  }

  flash(slotName) {
    const n = this.slots[slotName]?.firstChild;
    if (!n) return;
    n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
    setTimeout(() => n.classList.remove('flash'), 1300);
  }
}

// A board tap opens overlays on pointerup; the browser's follow-up click would land on whatever the overlay put under
// the finger (e.g. an action button), so swallow that one click.
let ghostUntil = 0;
function suppressGhostClick() { ghostUntil = performance.now() + 450; }
document.addEventListener('click', (e) => {
  if (performance.now() < ghostUntil) { e.stopPropagation(); e.preventDefault(); ghostUntil = 0; }
}, true);

// Pinch-zoom / pan / tap for the board (pointer events; works for touch and mouse).
export class PanZoom {
  constructor(stage, el, onTap) {
    this.stage = stage; this.el = el; this.onTap = onTap;
    this.s = 1; this.x = 0; this.y = 0; this.min = 1; this.max = 4;
    this.pts = new Map(); this.gesture = null;
    this.resetBtn = document.getElementById('btn-reset-zoom');
    this.resetBtn.addEventListener('click', (e) => { e.stopPropagation(); this.fit(true); });
    stage.addEventListener('pointerdown', (e) => this.down(e));
    stage.addEventListener('pointermove', (e) => this.move(e));
    stage.addEventListener('pointerup', (e) => this.up(e));
    stage.addEventListener('pointercancel', (e) => { this.pts.delete(e.pointerId); this.gesture = null; });
    stage.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    new ResizeObserver(() => this.fit(false)).observe(stage);
  }
  fitScale() { const r = this.stage.getBoundingClientRect(); return Math.min(r.width / BW, r.height / BH); }
  fit(animate) {
    const r = this.stage.getBoundingClientRect();
    this.min = this.fitScale(); this.s = this.min;
    this.x = (r.width - BW * this.s) / 2; this.y = Math.max(0, (r.height - BH * this.s) / 2);
    this.apply(animate);
  }
  clamp() {
    const r = this.stage.getBoundingClientRect();
    this.s = Math.min(this.max, Math.max(this.min, this.s));
    const w = BW * this.s, hh = BH * this.s;
    this.x = w <= r.width ? (r.width - w) / 2 : Math.min(0, Math.max(r.width - w, this.x));
    this.y = hh <= r.height ? (r.height - hh) / 2 : Math.min(0, Math.max(r.height - hh, this.y));
  }
  apply(animate) {
    this.clamp();
    this.el.classList.toggle('animating', !!animate);
    this.el.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.s})`;
    this.resetBtn.classList.toggle('hidden', this.s <= this.min * 1.02);
    if (animate) setTimeout(() => this.el.classList.remove('animating'), 380);
  }
  zoomAt(cx, cy, ns) {
    const r = this.stage.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top;
    ns = Math.min(this.max, Math.max(this.min, ns));
    this.x = px - (px - this.x) * (ns / this.s); this.y = py - (py - this.y) * (ns / this.s); this.s = ns;
    this.apply(false);
  }
  down(e) {
    if (e.target.closest('#btn-reset-zoom')) return;
    this.stage.setPointerCapture?.(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pts.size === 1) this.gesture = { type: 'tap', sx: e.clientX, sy: e.clientY, x0: this.x, y0: this.y, t: Date.now(), target: e.target };
    else if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      this.gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: this.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, x0: this.x, y0: this.y };
    }
  }
  move(e) {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture; if (!g) return;
    if (g.type === 'pinch' && this.pts.size >= 2) {
      const [a, b] = [...this.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const r = this.stage.getBoundingClientRect();
      const ns = Math.min(this.max, Math.max(this.min, g.s0 * d / g.d0));
      const px = g.mx - r.left, py = g.my - r.top;
      this.x = px - (px - g.x0) * (ns / g.s0) + (mx - g.mx); this.y = py - (py - g.y0) * (ns / g.s0) + (my - g.my); this.s = ns;
      this.apply(false);
    } else if (g.type === 'tap' || g.type === 'pan') {
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (g.type === 'tap' && Math.hypot(dx, dy) > 9) g.type = 'pan';
      if (g.type === 'pan') { this.x = g.x0 + dx; this.y = g.y0 + dy; this.apply(false); }
    }
  }
  up(e) {
    const g = this.gesture;
    this.pts.delete(e.pointerId);
    if (g && g.type === 'tap' && this.pts.size === 0) {
      const t = document.elementFromPoint(e.clientX, e.clientY) || g.target;
      suppressGhostClick();
      this.onTap(t?.closest?.('[data-tap]') || null);
    }
    if (this.pts.size === 0) this.gesture = null;
    else if (this.pts.size === 1) { const [p] = [...this.pts.values()]; this.gesture = { type: 'pan', sx: p.x, sy: p.y, x0: this.x, y0: this.y }; }
  }
  wheel(e) {
    e.preventDefault();
    this.zoomAt(e.clientX, e.clientY, this.s * Math.exp(-e.deltaY * 0.0015));
  }
}
