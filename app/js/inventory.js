import { h, sleep } from './dom.js';

// The eye button shows the players' inventory over whatever screen is up and returns to it unchanged.
// While the inventory is open the game waits: AI moves, auction playback and auto-commits resume when it closes.
const EYE_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
const EYE_SHUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 10.5s3.6 5 9.5 5 9.5-5 9.5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 14.2 3.4 16.4M9.2 15.9l-.7 2.6M14.8 15.9l.7 2.6M19 14.2l1.6 2.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

let render = null; let current = null; let btn = null; let waiters = [];

export const isOpen = () => !!current;

/** Resolves at once, or when the inventory closes. */
export function idle() { return current ? new Promise((r) => waiters.push(r)) : Promise.resolve(); }

/** sleep() whose clock stops while the inventory is open. */
export async function pausableSleep(ms) {
  let left = ms;
  while (left > 0) {
    await idle();
    const t0 = performance.now();
    await sleep(Math.min(left, 50));
    if (!current) left -= performance.now() - t0;
  }
}

function paint() {
  if (!btn) return;
  const on = !!current;
  btn.classList.toggle('on', on);
  btn.innerHTML = on ? EYE_SHUT : EYE_OPEN;
  btn.setAttribute('aria-label', on ? 'Back to the game' : 'Players');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/** `draw(close)` opens the inventory sheet and returns { el, close, refresh }. */
export function mountEye(draw) {
  render = draw;
  btn = h('button', { type: 'button', class: 'eye-toggle', 'data-testid': 'eye-toggle', 'data-eye': '' });
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  document.body.appendChild(btn);
  paint();
  return btn;
}

export function toggle() { if (current) close(); else open(); }

export function open() {
  if (current || !render) return;
  current = render(close);
  document.body.classList.add('inv-open');
  paint();
}

export function close() {
  if (!current) return;
  const ov = current; current = null;
  ov.close();
  document.body.classList.remove('inv-open');
  paint();
  const w = waiters; waiters = [];
  w.forEach((r) => r());
}

/** Redraw an open inventory from the latest view (a load or new game replaces the players). */
export function refresh() { current?.refresh(); }
