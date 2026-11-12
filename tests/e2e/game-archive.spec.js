import fs from 'fs';
import { test, expect } from './fixtures.js';

// fixtures/last-turn-before-game-over.json: a seeded 2-seat game (ai_seed 1002) one AI move from the end. Keith is the
// human; Newt (hard, tycoon) plays the last turn, which ends the game 72-39 in round 30.
const LAST_TURN = fs.readFileSync('tests/e2e/fixtures/last-turn-before-game-over.json', 'utf8');
const UNFINISHED = fs.readFileSync('engine/game/g8_state.json', 'utf8');
const ARCHIVE = 'https://lw-archive.test/';

async function open(page, save, { status = 200 } = {}) {
  const posts = [];
  await page.route(ARCHIVE, async (route) => {
    const req = route.request();
    const form = await new Response(req.postDataBuffer(), { headers: { 'content-type': req.headers()['content-type'] } }).formData();
    posts.push(Object.fromEntries(form.entries()));
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { ok: true } : { error: 'down' }) });
  });
  await page.addInitScript(({ save, url }) => {
    window.LW_GAME_ARCHIVE_URL = url;
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lw.save.v1', save); sessionStorage.setItem('seeded', '1'); }
  }, { save, url: ARCHIVE });
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  return posts;
}

const gameOver = (page) => page.waitForFunction(() => window.lwDebug.view().game_over, null, { timeout: 90_000 });
const stored = (page) => page.evaluate(() => ({
  pending: JSON.parse(localStorage.getItem('lw.game-archive.pending')),
  done: JSON.parse(localStorage.getItem('lw.game-archive.done')),
}));
// Load a finished save the way the menu's Load Save does (boot itself starts a new game over a finished save).
const loadFinished = (page, text) => page.evaluate(async (text) => {
  const g = window.lwDebug._g; const r = await g.call('load', { text });
  g.setView(r.result, { fresh: true });
}, text);

test('a finished game is saved once, silently, with its summary; it is never sent again', async ({ page }) => {
  const posts = await open(page, LAST_TURN);
  await gameOver(page);
  await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
  const [p] = posts;
  expect(p.kind).toBe('game');
  expect(p.gameId).toMatch(/^[0-9a-f]{12}$/);
  const state = JSON.parse(p.gameState);
  expect(state.meta.game_over).toBe(true);
  const s = JSON.parse(p.summary);
  expect(s).toMatchObject({
    game_id: p.gameId, ai_seed: 1002, rounds: 30, winner: 'Keith', final_vp: { Keith: 72, Newt: 39 },
    players: [
      { name: 'Keith', human: true, ai_level: null, ai_profile: null, vp: 72 },
      { name: 'Newt', human: false, ai_level: 'hard', ai_profile: 'tycoon', vp: 39 },
    ],
  });
  expect(s.build).toBeTruthy();
  expect(s.sha).toBeTruthy();
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
  expect(await stored(page)).toEqual({ pending: null, done: [p.gameId] });

  // More views of the same finished game (Scores, settle) and loading it again send nothing.
  await loadFinished(page, p.gameState);
  await page.reload();
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  await loadFinished(page, p.gameState);
  await page.waitForTimeout(1500);
  expect(posts).toHaveLength(1);
});

test('an unfinished game sends nothing', async ({ page }) => {
  const posts = await open(page, UNFINISHED);
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.lwDebug.view().game_over)).toBe(false);
  expect(posts).toHaveLength(0);
  expect(await stored(page)).toEqual({ pending: null, done: null });
});

test('a failed save stays pending, is retried once on the next load, then dropped', async ({ page }) => {
  const posts = await open(page, LAST_TURN, { status: 500 });
  await gameOver(page);
  await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await stored(page)).pending?.tries).toBe(1);
  const id = posts[0].gameId;

  await page.reload();
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(2);
  expect(posts[1].gameId).toBe(id);
  await expect.poll(async () => (await stored(page)).pending).toBeNull();
  expect((await stored(page)).done).toEqual([id]);

  await page.reload();
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  await loadFinished(page, posts[0].gameState);
  await page.waitForTimeout(1500);
  expect(posts).toHaveLength(2);
});
