// Cloudflare Worker: in-game relay for the Lizard Wizard web app (https://lw-bug-relay.keithschaub.workers.dev).
// POST multipart/form-data:
//   Report Bug:     description, metadata (JSON), gameState, image_0..N -> reports/<ISO>-<id>/ + a GitHub issue
//   finished game:  kind=game, gameId, summary (JSON), gameState       -> games/<ISO>-<gameId>/ (no issue)
// Files go to the bug-reports branch through the contents API. GITHUB_TOKEN is a Worker secret.
const REPO = 'keithschaub/lizard-wizard-dashboard';
const BRANCH = 'bug-reports';
const BASE = 'Jan18_2025';
const ORIGINS = ['https://keithschaub.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];
const MAX_TOTAL = 25 * 1024 * 1024;

function cors(origin) {
  const o = ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'POST, OPTIONS, GET', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
}
async function gh(env, method, path, body) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'lw-bug-relay', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  return { ok: r.ok, status: r.status, j };
}
function b64(buf) {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function ensureBranch(env) {
  const r = await gh(env, 'GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  if (r.ok) return;
  const base = await gh(env, 'GET', `/repos/${REPO}/git/ref/heads/${BASE}`);
  if (!base.ok) throw new Error('base branch lookup failed ' + base.status);
  const c = await gh(env, 'POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: base.j.object.sha });
  if (!c.ok && c.status !== 422) throw new Error('branch create failed ' + c.status);
}
async function put(env, path, content64, msg) {
  const r = await gh(env, 'PUT', `/repos/${REPO}/contents/${path}`, { message: msg, content: content64, branch: BRANCH });
  if (!r.ok) throw new Error(`upload ${path} failed ${r.status}`);
}
const safe = (s) => String(s || '').replace(/[^\w.-]+/g, '_').slice(0, 60);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const text64 = (s) => b64(new TextEncoder().encode(s));

// A finished game for AI learning: game-state.json + summary.json, once per game id, no issue.
async function saveGame(env, form, origin) {
  const gameId = String(form.get('gameId') || '');
  const gameState = String(form.get('gameState') || '');
  let summary; try { summary = JSON.parse(form.get('summary') || ''); } catch { summary = null; }
  if (!/^[0-9a-f]{6,32}$/.test(gameId) || !gameState || !summary || typeof summary !== 'object') return json({ error: 'gameId, summary and gameState required' }, 400, origin);
  try { if (!JSON.parse(gameState).meta?.game_over) return json({ error: 'game is not finished' }, 400, origin); } catch { return json({ error: 'gameState is not JSON' }, 400, origin); }
  await ensureBranch(env);
  const listing = await gh(env, 'GET', `/repos/${REPO}/contents/games?ref=${BRANCH}`);
  const seen = listing.ok && Array.isArray(listing.j) ? listing.j.find((x) => x.name.endsWith(`-${gameId}`)) : null;
  if (seen) return json({ ok: true, duplicate: true, dir: seen.path }, 200, origin);
  const dir = `games/${stamp()}-${gameId}`;
  await put(env, `${dir}/game-state.json`, text64(gameState), `game ${gameId}: state`);
  await put(env, `${dir}/summary.json`, text64(JSON.stringify({ ...summary, game_id: gameId, received_at: new Date().toISOString() }, null, 2) + '\n'), `game ${gameId}: summary`);
  return json({ ok: true, dir }, 200, origin);
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (req.method === 'GET') return json({ ok: true, service: 'lizard-wizard bug relay' }, 200, origin);
    if (req.method !== 'POST') return json({ error: 'method' }, 405, origin);
    if (origin && !ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, origin);
    const len = +(req.headers.get('Content-Length') || 0);
    if (len > MAX_TOTAL) return json({ error: 'too large' }, 413, origin);
    try {
      const form = await req.formData();
      if (form.get('kind') === 'game') return await saveGame(env, form, origin);
      const description = String(form.get('description') || '').slice(0, 20000);
      let meta = {}; try { meta = JSON.parse(form.get('metadata') || '{}'); } catch {}
      const gameState = String(form.get('gameState') || '');
      if (!description.trim()) return json({ error: 'description required' }, 400, origin);
      const id = stamp() + '-' + Math.random().toString(36).slice(2, 7);
      const dir = `reports/${id}`;
      await ensureBranch(env);
      const files = [];
      if (gameState) { await put(env, `${dir}/game-state.json`, text64(gameState), `bug report ${id}: state`); files.push({ name: 'game-state.json', kind: 'state' }); }
      for (const [k, v] of form.entries()) {
        if (!k.startsWith('image_') || typeof v === 'string') continue;
        if (v.size > 6 * 1024 * 1024) continue;
        const name = `${k}-${safe(v.name || 'image.png')}`;
        await put(env, `${dir}/${name}`, b64(await v.arrayBuffer()), `bug report ${id}: ${name}`);
        files.push({ name, kind: 'image' });
      }
      const blob = (n) => `https://github.com/${REPO}/blob/${BRANCH}/${dir}/${n}`;
      const raw = (n) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${dir}/${n}`;
      const firstLine = description.split('\n')[0].trim().slice(0, 80);
      const metaRows = Object.entries(meta).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '\\|').slice(0, 200)} |`).join('\n');
      const body = [
        '### What happened', '', description, '',
        metaRows ? '### Details\n\n| Field | Value |\n|---|---|\n' + metaRows + '\n' : '',
        files.some((f) => f.kind === 'state') ? `### Game state\n\n[game-state.json](${blob('game-state.json')})\n` : '',
        ...files.filter((f) => f.kind === 'image').map((f) => `![${f.name}](${raw(f.name)})`),
        '', `_Filed from the in-game Report Bug button · report ${id}_`,
      ].join('\n');
      const issue = await gh(env, 'POST', `/repos/${REPO}/issues`, { title: `[Bug] ${firstLine || 'In-game report'}`, body, labels: ['bug', 'in-game-report'] });
      if (!issue.ok) {
        const retry = await gh(env, 'POST', `/repos/${REPO}/issues`, { title: `[Bug] ${firstLine || 'In-game report'}`, body });
        if (!retry.ok) throw new Error('issue create failed ' + retry.status);
        return json({ ok: true, issue_url: retry.j.html_url, number: retry.j.number }, 200, origin);
      }
      return json({ ok: true, issue_url: issue.j.html_url, number: issue.j.number }, 200, origin);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502, origin);
    }
  },
};
