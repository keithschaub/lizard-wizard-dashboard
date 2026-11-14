import fs from 'fs';
import { test, expect } from './fixtures.js';

// Issue #129. fixtures/issue-129-last-turn.json: a seeded duel (13InchesOfFun vs Newt) one AI move from the end.
// Newt's last turn ends the game 79-61 in round 31. Reloading after the end must show that finished game and its
// Game Over screen again, never the bundled round-2 starting position (Keith, Newt, LizWiz).
const LAST_TURN = fs.readFileSync('tests/e2e/fixtures/issue-129-last-turn.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

const ready = (page) => page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 90_000 });
const snapshot = (page) => page.evaluate(() => {
  const v = window.lwDebug.view();
  return { round: v.round, gameOver: v.game_over, players: v.players.map((p) => p.name), saved: JSON.parse(localStorage.getItem('lw.save.v1')).meta.round };
});

test('a finished game survives a reload with its Game Over screen (issue #129)', async ({ page }) => {
  await page.addInitScript((t) => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1'); }
  }, LAST_TURN);
  await page.goto('/');
  await ready(page);
  await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('winner')).toHaveText('13InchesOfFun wins');
  const end = await snapshot(page);
  expect(end).toEqual({ round: 31, gameOver: true, players: ['13InchesOfFun', 'Newt'], saved: 31 });

  for (let i = 0; i < 2; i++) {
    await page.reload();
    await ready(page);
    await expect(page.getByTestId('game-over')).toBeVisible();
    expect(await snapshot(page)).toEqual(end);
    await expect(page.getByTestId('round')).toHaveText('Game over');
  }

  // From there a new game is one tap away.
  await page.getByTestId('go-play-again').tap();
  await expect(page.getByTestId('new-game')).toBeVisible();
});
