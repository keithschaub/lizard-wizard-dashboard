// Web Worker: runs the original Python engine (engine/scripts) plus the web glue (engine/web/lw_web.py) in Pyodide.
// The full game state lives only here; the page receives the public view built by lw_web.view().
const PYODIDE_VERSION = '314.0.7';
const ENGINE_FILES = [
  'scripts/actions.py', 'scripts/ai_policy.py', 'scripts/ai_sim.py', 'scripts/build_carddb.py', 'scripts/carddb.py',
  'scripts/scoring.py', 'scripts/spell_effects.py', 'scripts/turn.py', 'scripts/turn_package.py',
  'cards/cards.json', 'cards/dungeon_cards.json', 'cards/other_cards_from_pc.json', 'cards/reagent_cards.json',
  'cards/spells_from_pc.json', 'cards/carddb.json', 'assets/dungeon_from_photos.json', 'web/lw_web.py',
];
const ROOT = new URL('../../', import.meta.url);
let api = null;

function status(text) { self.postMessage({ type: 'status', text }); }

async function loadRuntime() {
  const local = new URL('vendor/pyodide/', ROOT).href;
  try {
    const mod = await import(local + 'pyodide.mjs');
    return await mod.loadPyodide({ indexURL: local, stdout: () => {}, stderr: (t) => console.warn('[py]', t) });
  } catch (e) {
    const cdn = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
    const mod = await import(cdn + 'pyodide.mjs');
    return await mod.loadPyodide({ indexURL: cdn, stdout: () => {}, stderr: (t) => console.warn('[py]', t) });
  }
}

async function init() {
  status('Waking the Python runtime…');
  const [py, files] = await Promise.all([
    loadRuntime(),
    Promise.all(ENGINE_FILES.map(async (f) => {
      const r = await fetch(new URL('engine/' + f, ROOT));
      if (!r.ok) throw new Error(`engine file ${f}: HTTP ${r.status}`);
      return [f, new Uint8Array(await r.arrayBuffer())];
    })),
  ]);
  status('Loading the rules engine…');
  for (const [f, data] of files) {
    const path = '/lw/engine/' + f;
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    py.FS.writeFile(path, data);
  }
  // carddb.py rebuilds carddb.json if a source JSON looks newer; pin the committed build as newest.
  py.runPython(`
import os, time, sys
_t = time.time()
for _d, _, _fs in os.walk('/lw/engine'):
    for _f in _fs: os.utime(os.path.join(_d, _f), (_t - 60, _t - 60))
os.utime('/lw/engine/cards/carddb.json', (_t, _t))
sys.path.insert(0, '/lw/engine/web')
import lw_web
`);
  const mod = py.pyimport('lw_web');
  api = mod.call;
  status('Shuffling the decks…');
}

self.onmessage = async (ev) => {
  const { id, fn, args } = ev.data;
  try {
    if (fn === '__init__') {
      if (!api) await init();
      self.postMessage({ id, out: JSON.stringify({ ok: true }) });
      return;
    }
    const out = api(fn, JSON.stringify(args || {}));
    self.postMessage({ id, out });
  } catch (e) {
    self.postMessage({ id, out: JSON.stringify({ ok: false, error: String(e && e.message || e).split('\n').slice(-3).join(' ') }) });
  }
};
