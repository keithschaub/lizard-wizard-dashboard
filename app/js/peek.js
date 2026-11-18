import { h, sleep } from './dom.js';

// Floating peeks over any screen: the eye (players' inventory) and the ? (turn steps). Each opens a sheet over the
// current screen and returns to it unchanged. While any sheet is open the game waits: AI moves, auction playback and
// auto-commits resume when the last one closes.
const EYE_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
const EYE_SHUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 10.5s3.6 5 9.5 5 9.5-5 9.5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 14.2 3.4 16.4M9.2 15.9l-.7 2.6M14.8 15.9l.7 2.6M19 14.2l1.6 2.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const peeks = {};
let waiters = [];

/** True while any peek sheet is open. */
export const isOpen = () => Object.values(peeks).some((p) => p.current);
export const isShown = (name) => !!peeks[name]?.current;

/** Resolves at once, or when the last peek sheet closes. */
export function idle() { return isOpen() ? new Promise((r) => waiters.push(r)) : Promise.resolve(); }

/** sleep() whose clock stops while a peek sheet is open. */
export async function pausableSleep(ms) {
  let left = ms;
  while (left > 0) {
    await idle();
    const t0 = performance.now();
    await sleep(Math.min(left, 50));
    if (!isOpen()) left -= performance.now() - t0;
  }
}

function paint(name) {
  const p = peeks[name]; const on = !!p.current;
  p.btn.classList.toggle('on', on);
  p.btn.innerHTML = on ? p.iconOn : p.icon;
  p.btn.setAttribute('aria-label', on ? 'Back to the game' : p.label);
  p.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/** `draw(close)` opens the sheet and returns { el, close, refresh }. */
function mount(name, { cls, testid, label, icon, iconOn, draw }) {
  const btn = h('button', { type: 'button', class: `peek-btn ${cls}`, 'data-testid': testid, 'data-peek': name });
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(name); });
  peeks[name] = { btn, draw, label, icon, iconOn, current: null };
  document.body.appendChild(btn);
  paint(name);
  return btn;
}

export function mountEye(draw) {
  return mount('eye', { cls: 'eye-toggle', testid: 'eye-toggle', label: 'Players', icon: EYE_OPEN, iconOn: EYE_SHUT, draw });
}

export function mountHelp(draw) {
  return mount('help', { cls: 'help-toggle', testid: 'help-toggle', label: 'Turn steps', icon: '<span aria-hidden="true">?</span>', iconOn: '<span aria-hidden="true">?</span>', draw });
}

export function toggle(name) { if (peeks[name]?.current) close(name); else open(name); }

export function open(name) {
  const p = peeks[name];
  if (!p || p.current) return;
  p.current = p.draw(() => close(name));
  document.body.classList.add('peek-open');
  paint(name);
}

export function close(name) {
  const p = peeks[name];
  if (!p?.current) return;
  const ov = p.current; p.current = null;
  ov.close();
  paint(name);
  if (isOpen()) return;
  document.body.classList.remove('peek-open');
  const w = waiters; waiters = [];
  w.forEach((r) => r());
}

/** Redraw open sheets from the latest view (a load or new game replaces the players). */
export function refresh() { Object.values(peeks).forEach((p) => p.current?.refresh()); }
