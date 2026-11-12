// relay/worker.js against a fake GitHub API: finished games go to games/<ISO>-<id>/ (state + summary, no issue,
// once per game id); bug reports still go to reports/<ISO>-<id>/ and file an issue.
import assert from 'node:assert/strict';
import worker from '../relay/worker.js';

const calls = [];
const files = new Map();
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, path: u.pathname + u.search, body });
  const reply = (status, j) => new Response(JSON.stringify(j), { status });
  if (u.pathname.endsWith('/git/ref/heads/bug-reports')) return reply(200, { object: { sha: 'abc' } });
  const m = u.pathname.match(/\/contents\/(.+)$/);
  if (m && method === 'PUT') { files.set(m[1], Buffer.from(body.content, 'base64').toString()); return reply(201, {}); }
  if (m && method === 'GET') {
    const dir = m[1]; const names = new Set([...files.keys()].filter((k) => k.startsWith(dir + '/')).map((k) => k.slice(dir.length + 1).split('/')[0]));
    return names.size ? reply(200, [...names].map((n) => ({ name: n, path: `${dir}/${n}`, type: 'dir' }))) : reply(404, { message: 'Not Found' });
  }
  if (u.pathname.endsWith('/issues') && method === 'POST') return reply(201, { number: 7, html_url: 'https://github.com/x/y/issues/7' });
  throw new Error(`unexpected ${method} ${u.pathname}`);
};

const post = (fields) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return worker.fetch(new Request('https://relay.test/', { method: 'POST', body: form, headers: { Origin: 'https://keithschaub.github.io' } }), { GITHUB_TOKEN: 't' });
};
const finished = JSON.stringify({ meta: { game_over: true, round: 30 } });
const summary = JSON.stringify({ build: 99, sha: 'abc1234', winner: 'Keith', final_vp: { Keith: 72, Newt: 39 } });

let r = await post({ kind: 'game', gameId: 'a1b2c3d4e5f6', summary, gameState: finished });
let j = await r.json();
assert.equal(r.status, 200, JSON.stringify(j));
assert.match(j.dir, /^games\/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-a1b2c3d4e5f6$/);
assert.deepEqual([...files.keys()].sort(), [`${j.dir}/game-state.json`, `${j.dir}/summary.json`]);
assert.equal(files.get(`${j.dir}/game-state.json`), finished);
const saved = JSON.parse(files.get(`${j.dir}/summary.json`));
assert.equal(saved.game_id, 'a1b2c3d4e5f6'); assert.equal(saved.winner, 'Keith'); assert.ok(saved.received_at);
assert.ok(!calls.some((c) => c.path.endsWith('/issues')), 'a game save files no issue');
console.log('PASS finished game saved to', j.dir, 'with no issue');

const before = files.size;
r = await post({ kind: 'game', gameId: 'a1b2c3d4e5f6', summary, gameState: finished }); j = await r.json();
assert.equal(r.status, 200); assert.equal(j.duplicate, true); assert.equal(files.size, before);
console.log('PASS the same game id is not stored twice');

r = await post({ kind: 'game', gameId: 'ffffffffffff', summary, gameState: JSON.stringify({ meta: { game_over: false } }) });
assert.equal(r.status, 400); assert.equal(files.size, before);
r = await post({ kind: 'game', gameId: 'not-hex!', summary, gameState: finished });
assert.equal(r.status, 400); assert.equal(files.size, before);
console.log('PASS unfinished games and bad ids are refused');

r = await post({ kind: 'game', gameId: 'abcdefabcdef', summary, gameState: finished });
assert.equal(r.status, 200);
r = await post({ description: 'towers cost too much', metadata: JSON.stringify({ build: 99 }), gameState: finished }); j = await r.json();
assert.equal(r.status, 200); assert.equal(j.number, 7);
assert.ok([...files.keys()].some((k) => /^reports\/.+\/game-state\.json$/.test(k)));
console.log('PASS bug reports still file an issue under reports/');
console.log('relay OK');
