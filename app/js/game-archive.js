// Finished-game archive: when a game ends, its final state goes once, silently, to the same relay the Report Bug
// button uses (kind=game), which stores it on the bug-reports branch under games/<ISO time>-<id>/ for AI learning.
// No UI. A failed upload stays pending in localStorage and is retried once on the next app load, then dropped.
import { BUILD, SHA } from './version.js';

const PENDING_KEY = 'lw.game-archive.pending';
const DONE_KEY = 'lw.game-archive.done';   // game ids already uploaded or given up on
const DONE_MAX = 200;
const MAX_TRIES = 2;                       // the upload at game end, then one retry on the next load

// Only the deployed site archives by default (local dev and tests stay quiet); tests set LW_GAME_ARCHIVE_URL.
// The relay URL is the Report Bug one (window.LW_RELAY_URL, set in index.html).
const archiveUrl = () => window.LW_GAME_ARCHIVE_URL
  ?? (location.hostname === 'keithschaub.github.io' && window.LW_RELAY_URL && window.LW_RELAY_URL !== 'undefined' ? window.LW_RELAY_URL : '');

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full: skip */ } };
const markDone = (id) => write(DONE_KEY, [...read(DONE_KEY, []).filter((x) => x !== id), id].slice(-DONE_MAX));

// The seeds and the whole log identify one playthrough; replaying the same deal gives a different log.
export async function gameIdOf(state) {
  const key = JSON.stringify([state.seed, state.hands_seed, state.board_seed, state.meta?.ai_seed, state.meta?.log]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function summaryOf(state, view, gameId) {
  const m = state.meta || {};
  const humans = view.humans || m.humans || [];
  const final = view.final || {};
  const top = Math.max(...Object.values(final));
  const winners = Object.keys(final).filter((n) => final[n] === top);
  return {
    game_id: gameId,
    build: BUILD,
    sha: SHA,
    players: (m.seat_order || state.players.map((p) => p.name)).map((name) => ({
      name,
      human: humans.includes(name),
      ai_level: humans.includes(name) ? null : (m.ai_levels || {})[name] ?? null,
      ai_profile: humans.includes(name) ? null : (m.ai_profiles || {})[name] ?? null,
      vp: final[name] ?? null,
    })),
    ai_seed: m.ai_seed ?? null,
    final_vp: final,
    winner: winners.length === 1 ? winners[0] : winners,
    rounds: view.round ?? m.round ?? null,
  };
}

async function upload(item) {
  const url = archiveUrl();
  if (!url) throw new Error('no archive url');
  const form = new FormData();
  form.append('kind', 'game');
  form.append('gameId', item.id);
  form.append('summary', JSON.stringify(item.summary));
  form.append('gameState', item.state);
  const r = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`archive ${r.status}`);
}

async function attempt(item) {
  item.tries = (item.tries || 0) + 1;
  write(PENDING_KEY, item);
  try {
    await upload(item);
    markDone(item.id); localStorage.removeItem(PENDING_KEY);
  } catch {
    if (item.tries >= MAX_TRIES) { markDone(item.id); localStorage.removeItem(PENDING_KEY); }
  }
}

let busy = null;

// Called with every view; does work only the first time a given finished game is seen.
export function noteView(game, view) {
  if (!view?.game_over || busy || !archiveUrl() || !window.crypto?.subtle) return busy;
  busy = (async () => {
    try {
      const d = await game.call('dump');
      if (!d.ok) return;
      const state = JSON.parse(d.result);
      const id = await gameIdOf(state);
      if (read(DONE_KEY, []).includes(id) || read(PENDING_KEY, null)?.id === id) return;
      await attempt({ id, state: d.result, summary: summaryOf(state, view, id) });
    } catch { /* never surfaces */ } finally { busy = null; }
  })();
  return busy;
}

// On app load: one more try for an upload that failed last time.
export async function retryPending() {
  const item = read(PENDING_KEY, null);
  if (!item?.id || !archiveUrl()) return;
  if (read(DONE_KEY, []).includes(item.id)) { localStorage.removeItem(PENDING_KEY); return; }
  await attempt(item);
}
