import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot, watchErrors } from './helpers.js';

// Issue #135. fixtures/issue-135-scry-familiar.json: Keith's round 26 save right after Scry Familiar took
// Familiar_15_Corvum (collect 5 Nightshade & Cast Spells); its use-now choice is pending. Tapping Gather used to throw
// (g.v.legal is null while a choice is pending) and left the turn stuck on "Finish your move".
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-135-scry-familiar.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

async function openRise(page, save) {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), save);
  await boot(page);
  await expect(page.getByTestId('rise-use')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('rise-use')).toContainText('Scry Familiar');
}

const me = (page) => page.evaluate(() => window.lwDebug.view().players.find((p) => p.you));

test('Scry Familiar: Gather collects 5 Nightshade and the turn goes on (issue #135)', async ({ page }) => {
  const errors = watchErrors(page);
  await openRise(page, SAVE);
  await page.getByTestId('rise-gather').tap();
  await expect.poll(async () => (await me(page)).tok.filter((t) => t === 'Nightshade').length, { timeout: 30_000 }).toBe(5);
  await expect.poll(() => page.evaluate(() => window.lwDebug.view().pending)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.lwDebug.view().next), { timeout: 30_000 }).not.toBe('13InchesOfFun');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Scry Familiar: the gathered tokens open the cast window, and the cast resolves (issue #135)', async ({ page }) => {
  const errors = watchErrors(page);
  const s = JSON.parse(SAVE);
  s.players.find((p) => p.name === '13InchesOfFun').tok.push('Foxglove');   // Disintegrate: Foxglove x2 + Nightshade x2
  await openRise(page, JSON.stringify(s));
  await page.getByTestId('rise-gather').tap();
  const flow = page.getByTestId('rise-gather-flow');
  await expect(flow).toContainText('Cast any of your spells');
  await flow.getByTestId('cast-Spell_Disintegrate_N').tap();
  await flow.getByTestId('skip-cast').tap();
  await expect(page.getByTestId('effect')).toBeVisible({ timeout: 30_000 });
  const v = await page.evaluate(() => window.lwDebug.view());
  expect(v.pending.type).toBe('effect');
  const mine = await me(page);
  expect(mine.spells.find((x) => (x.key || '').includes('Disintegrate')).cast).toBe(true);
  expect(mine.tok.filter((t) => t === 'Nightshade').length).toBe(3);
  const log = await page.evaluate(() => window.lwDebug.log());
  const rise = log.findIndex((e) => e.act === 'rise' && e.r === 26);
  const cast = log.findIndex((e) => e.act === 'cast' && e.r === 26 && JSON.stringify(e).includes('Disintegrate'));
  expect(rise).toBeGreaterThanOrEqual(0);
  expect(cast, 'the cast follows the rise that enabled it').toBeGreaterThan(rise);
  expect(errors, errors.join('\n')).toEqual([]);
});
