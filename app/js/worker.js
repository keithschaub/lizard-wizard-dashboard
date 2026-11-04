// Web Worker: runs the original Python engine (engine/scripts) plus the web glue (engine/web/lw_web.py) in Pyodide.
// The full game state lives only here; the page receives the public view built by lw_web.view().
//
// Loading is defensive because Pyodide 314's own wasm instantiation swallows errors (it only console.warns
// "wasm instantiation failed!" and never settles loadPyodide), which shows up as an endless splash on phones:
//  * the two big runtime files are downloaded here with progress, a stall timeout and retries, and validated;
//  * Pyodide's fetches of those files are served from the validated bytes;
//  * WebAssembly instantiation failures are reported to the page instead of hanging;
//  * any uncaught error / rejection in the worker is reported to the page.
const PYODIDE_VERSION = '314.0.7';
const ENGINE_FILES = [
  'scripts/actions.py', 'scripts/ai_policy.py', 'scripts/ai_sim.py', 'scripts/build_carddb.py', 'scripts/carddb.py',
  'scripts/scoring.py', 'scripts/spell_effects.py', 'scripts/turn.py', 'scripts/turn_package.py',
  'cards/cards.json', 'cards/dungeon_cards.json', 'cards/other_cards_from_pc.json', 'cards/reagent_cards.json',
  'cards/spells_from_pc.json', 'cards/carddb.json', 'assets/dungeon_from_photos.json', 'web/lw_web.py',
];
const BIG_FILES = { 'pyodide.asm.wasm': 'Python runtime', 'python_stdlib.zip': 'Python library' };
const STALL_MS = 20000;
const TRIES = 3;
const ROOT = new URL('../../', import.meta.url);
let api = null;
let stage = 'starting';
let initPromise = null;
const prefetched = new Map();

const errText = (e) => String((e && (e.message || e.reason)) || e).split('\n').slice(-3).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function status(text, extra = {}) { stage = extra.stage || stage; self.postMessage({ type: 'status', text, stage, ...extra }); }
function fatal(where, e) { self.postMessage({ type: 'fatal', stage: where || stage, error: errText(e) }); }

let rejectFatal;
const fatalPromise = new Promise((_, rej) => { rejectFatal = rej; });
fatalPromise.catch(() => {});
function failInit(where, e) { const err = new Error(`${where}: ${errText(e)}`); err.stage = where; rejectFatal(err); }

self.addEventListener('error', (e) => fatal(stage, e.error || `${e.message} (${e.filename}:${e.lineno})`));
self.addEventListener('unhandledrejection', (e) => fatal(stage, e.reason));

const mb = (n) => (n / 1048576).toFixed(1);

async function download(url, label) {
  let last = null;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const ctl = new AbortController();
    let timer = null;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), STALL_MS); };
    try {
      arm();
      const r = await fetch(url, { signal: ctl.signal, cache: attempt > 1 ? 'reload' : 'default' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const encoded = !!r.headers.get('Content-Encoding');
      const total = encoded ? 0 : Number(r.headers.get('Content-Length')) || 0;
      let bytes;
      if (r.body && r.body.getReader) {
        const reader = r.body.getReader(); const chunks = []; let got = 0; let shown = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          arm(); chunks.push(value); got += value.length;
          if (Date.now() - shown > 250) {
            shown = Date.now();
            status(`Downloading the ${label}… ${mb(got)}${total ? ' / ' + mb(total) : ''} MB`, { stage: `download ${label}`, got, total });
          }
        }
        bytes = new Uint8Array(got); let o = 0;
        for (const c of chunks) { bytes.set(c, o); o += c.length; }
      } else bytes = new Uint8Array(await r.arrayBuffer());
      clearTimeout(timer);
      if (total && bytes.length !== total) throw new Error(`truncated download (${bytes.length} of ${total} bytes)`);
      if (url.endsWith('.wasm') && !WebAssembly.validate(bytes)) throw new Error(`corrupt download (${bytes.length} bytes do not validate as WebAssembly)`);
      return bytes;
    } catch (e) {
      clearTimeout(timer);
      last = ctl.signal.aborted ? new Error(`no data received for ${STALL_MS / 1000} s`) : e;
      if (attempt < TRIES) { status(`The ${label} download failed (${errText(last)}); retrying ${attempt + 1}/${TRIES}…`); await sleep(800 * attempt); }
    }
  }
  throw new Error(`downloading the ${label} failed ${TRIES} times: ${errText(last)}`);
}

// Pyodide fetches these itself; hand it the bytes that were already downloaded and validated.
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  const name = url.split('?')[0].split('/').pop();
  if (prefetched.has(name)) {
    const type = name.endsWith('.wasm') ? 'application/wasm' : 'application/zip';
    return Promise.resolve(new Response(prefetched.get(name), { status: 200, headers: { 'Content-Type': type } }));
  }
  return realFetch(input, init);
};

// Pyodide 314 catches instantiation errors and never settles loadPyodide: report them instead.
const realInstantiate = WebAssembly.instantiate.bind(WebAssembly);
const realStreaming = WebAssembly.instantiateStreaming ? WebAssembly.instantiateStreaming.bind(WebAssembly) : null;
WebAssembly.instantiateStreaming = async (source, imports) => {
  status('Compiling the Python runtime…', { stage: 'compile' });
  const bytes = prefetched.get('pyodide.asm.wasm');
  try {
    if (bytes) return await realInstantiate(bytes, imports);
    if (realStreaming) return await realStreaming(source, imports);
    return await realInstantiate(await (await source).arrayBuffer(), imports);
  } catch (e) { failInit('compiling the Python runtime (WebAssembly)', e); throw e; }
};
WebAssembly.instantiate = async (source, imports) => {
  const big = source && source.byteLength > 1e6;
  if (big) status('Compiling the Python runtime…', { stage: 'compile' });
  try { return await realInstantiate(source, imports); } catch (e) { if (big) failInit('compiling the Python runtime (WebAssembly)', e); throw e; }
};

async function importPyodide() {
  const local = new URL('vendor/pyodide/', ROOT).href;
  try { return { mod: await import(local + 'pyodide.mjs'), indexURL: local }; } catch (e) {
    const cdn = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
    try { return { mod: await import(cdn + 'pyodide.mjs'), indexURL: cdn }; } catch (e2) { throw new Error(`cannot load pyodide.mjs (local: ${errText(e)}; CDN: ${errText(e2)})`); }
  }
}

async function init(env) {
  // Pyodide skips WebKit's broken wasm-gc paths only when it recognises iOS; inside a worker navigator.maxTouchPoints
  // does not exist, so iPadOS and "Request Desktop Website" iPhones would not be recognised. Copy it from the page.
  if (env && typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'undefined' && typeof env.maxTouchPoints === 'number') {
    try { Object.defineProperty(navigator, 'maxTouchPoints', { value: env.maxTouchPoints, configurable: true }); } catch { /* read-only navigator */ }
  }
  status('Waking the Python runtime…', { stage: 'import' });
  const { mod, indexURL } = await importPyodide();
  const engineFiles = Promise.all(ENGINE_FILES.map(async (f) => {
    const r = await realFetch(new URL('engine/' + f, ROOT));
    if (!r.ok) throw new Error(`engine file ${f}: HTTP ${r.status}`);
    return [f, new Uint8Array(await r.arrayBuffer())];
  }));
  engineFiles.catch(() => {});
  for (const [name, label] of Object.entries(BIG_FILES)) prefetched.set(name, await download(indexURL + name, label));
  status('Starting Python…', { stage: 'start python' });
  const py = await Promise.race([
    mod.loadPyodide({ indexURL, stdout: () => {}, stderr: (t) => console.warn('[py]', t) }),
    fatalPromise,
  ]);
  prefetched.clear();
  status('Loading the rules engine…', { stage: 'engine' });
  const files = await engineFiles;
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
  api = py.pyimport('lw_web').call;
  status('Shuffling the decks…', { stage: 'ready' });
}

self.onmessage = async (ev) => {
  const { id, fn, args } = ev.data;
  try {
    if (fn === '__init__') {
      if (!api) { initPromise = initPromise || init(args); await initPromise; }
      self.postMessage({ id, out: JSON.stringify({ ok: true }) });
      return;
    }
    if (!api) throw new Error('the engine is not loaded');
    const out = api(fn, JSON.stringify(args || {}));
    self.postMessage({ id, out });
  } catch (e) {
    self.postMessage({ id, out: JSON.stringify({ ok: false, error: errText(e), stage: e && e.stage || stage }) });
  }
};
