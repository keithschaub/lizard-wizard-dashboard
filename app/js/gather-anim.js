// Gather animation: each gathered reagent flies from its column icon on the price board to where it is counted
// (a dock chip for the player, a banner chip for an AI). Counts tick only on landing.
import { h, reagentIcon, REAGENTS } from './dom.js';
import { BW } from './board.js';

export const FLIGHT_MS = 500;
export const TAIL_MS = 250;          // after the last landing, before the price markers step up
export const PULSE_MS = 300;
const GAP_NEW = 250;                 // between different reagents, for the first 3
const GAP_STREAM = 140;              // a repeat of the same reagent, and every reagent after the 3rd
const CAP_MS = 2000;                 // last landing plus TAIL_MS never runs past this
const TRAIL = 10;
const TRAIL_STEP = 0.035;            // each trail dot sits this much flight progress behind the one before
const HALO = 2.6;                    // the soft gold glow is this many times the icon size

// Screenshot captures pin the animation to a given moment (lwDebug.gatherClock.ms; null runs in real time) and can
// keep an AI gather banner on screen while they shoot (hold).
export const testClock = { ms: null, hold: false };

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Start time (ms) of each flight. */
export function schedule(reagents) {
  const starts = [];
  reagents.forEach((r, i) => {
    if (!i) { starts.push(0); return; }
    starts.push(starts[i - 1] + (i <= 2 && r !== reagents[i - 1] ? GAP_NEW : GAP_STREAM));
  });
  const last = starts[starts.length - 1] || 0;
  const room = CAP_MS - FLIGHT_MS - TAIL_MS;
  const k = last > room ? room / last : 1;
  return starts.map((t) => Math.round(t * k));
}

/** Screen centre of a reagent's column icon on the price board (board units: column i at x 66 + 96 i, icon at y 43). */
export function columnPoint(reagent) {
  const board = document.getElementById('board');
  const r = board.getBoundingClientRect(); const s = r.width / BW;
  const i = Math.max(0, REAGENTS.indexOf(reagent));
  return { x: r.left + (66 + 96 * i) * s, y: r.top + 43 * s };
}

const ease = (p) => -(Math.cos(Math.PI * p) - 1) / 2;
const sizeAt = (p) => (p < 0.5 ? 20 + 28 * p : 34 - 24 * (p - 0.5));

export function pulse(el) {
  if (!el) return;
  el.classList.remove('land-pulse'); void el.offsetWidth; el.classList.add('land-pulse');
  setTimeout(() => el.classList.remove('land-pulse'), PULSE_MS + 40);
}

/**
 * Fly `reagents` one by one. `target(r)` returns the element to land on (its centre is the end point);
 * `onLand(r, i)` runs as each one lands. Returns { done, finish }: `finish()` drops every flight still in the air
 * or queued and resolves `done` with the indices that never landed, so the caller can apply them at once.
 */
export function flyReagents(reagents, { target, onLand }) {
  const layer = document.getElementById('flight-layer') || document.body.appendChild(h('div', { id: 'flight-layer', 'data-testid': 'flight-layer' }));
  const starts = schedule(reagents);
  const flights = reagents.map((r, i) => ({ r, i, t0: starts[i], el: null, dots: [], landed: false }));
  let resolve; const done = new Promise((res) => { resolve = res; });
  let stopped = false; let t0 = null;
  const end = (rest) => {
    stopped = true;
    for (const f of flights) { f.el?.remove(); f.dots.forEach((d) => d.remove()); }
    resolve(rest);
  };
  const frame = (now) => {
    if (stopped) return;
    t0 ??= now;
    const t = testClock.ms ?? now - t0;
    for (const f of flights) {
      if (f.landed || t < f.t0) continue;
      if (!f.el) {
        f.from = columnPoint(f.r);
        f.el = h('div', { class: 'gflight', 'data-testid': 'gather-flight', 'data-reagent': f.r }, h('img', { src: reagentIcon(f.r), alt: '' }));
        f.dots = Array.from({ length: TRAIL }, (_, k) => h('span', { class: 'gtrail', style: { opacity: '0' }, 'data-k': k }));
        layer.append(...f.dots, f.el);
      }
      const p = Math.min(1, (t - f.t0) / FLIGHT_MS);
      const tgt = target(f.r)?.getBoundingClientRect();
      const to = tgt ? { x: tgt.left + tgt.width / 2, y: tgt.top + tgt.height / 2 } : f.from;
      const c = { x: f.from.x + 0.2 * (to.x - f.from.x), y: f.from.y + 0.6 * (to.y - f.from.y) };
      const at = (pp) => {
        const q = ease(Math.max(0, pp));
        return { x: (1 - q) ** 2 * f.from.x + 2 * (1 - q) * q * c.x + q * q * to.x, y: (1 - q) ** 2 * f.from.y + 2 * (1 - q) * q * c.y + q * q * to.y };
      };
      const { x, y } = at(p);
      const s = sizeAt(p);
      const halo = s * HALO;
      Object.assign(f.el.style, { width: `${halo}px`, height: `${halo}px`, transform: `translate(${x - halo / 2}px, ${y - halo / 2}px)` });
      Object.assign(f.el.firstChild.style, { width: `${s}px`, height: `${s}px` });
      f.dots.forEach((d, k) => {
        const pp = p - (k + 1) * TRAIL_STEP;
        if (pp <= 0) { d.style.opacity = '0'; return; }
        const pt = at(pp); const ds = 9 - k * 0.5;
        Object.assign(d.style, { opacity: String(0.45 * (1 - k / TRAIL)), width: `${ds}px`, height: `${ds}px`, transform: `translate(${pt.x - ds / 2}px, ${pt.y - ds / 2}px)` });
      });
      if (p >= 1) {
        f.landed = true; f.el.remove(); f.dots.forEach((d) => d.remove()); f.el = null;
        onLand(f.r, f.i);
      }
    }
    if (flights.every((f) => f.landed)) { end([]); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    done,
    finish: () => { if (!stopped) end(flights.filter((f) => !f.landed).map((f) => f.i)); },
  };
}
