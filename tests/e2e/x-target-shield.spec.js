// Invisibility Potion target picker: every opponent is listed, gold stays secret, and a player with a cast
// Spell Shield is dimmed, badged SHIELDED and cannot be picked.
// fixtures/four-player-spell-shield.json: g8 with a fourth seat (Gecko); LizWiz holds a cast Spell Shield.
import { test, expect } from './fixtures.js';
import fs from 'fs';

const SAVE = fs.readFileSync('tests/e2e/fixtures/four-player-spell-shield.json', 'utf8');
test.use({ viewport: { width: 430, height: 775 } });

test('X target picker lists all opponents and blocks the Spell Shield holder', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), SAVE);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await page.evaluate(() => {
    const g = window.lwDebug._g;
    window.__xt = null;
    const ov = window.ui.openOverlay('gather', { testid: 'x-picker' });
    window.ui.xTargetPicker(g, ov.el, 3, 'Invisibility Potion').then((r) => { window.__xt = r; });
  });

  const frame = page.getByTestId('x-target-frame');
  await expect(frame).toBeVisible();
  await expect(frame.locator('.phase-title')).toContainText('Invisibility Potion: pay X');
  await expect(page.getByTestId('x-target-eye')).toBeVisible();
  await expect(frame.locator('.log-reagent-chip')).toHaveCount(0);
  for (const name of ['Newt', 'LizWiz', 'Gecko']) await expect(page.getByTestId(`x-target-${name}`)).toBeVisible();
  await expect(frame).not.toContainText('Gold');

  const liz = page.getByTestId('x-target-LizWiz');
  await expect(liz).toBeDisabled();
  await expect(liz).toHaveClass(/shielded/);
  await expect(page.getByTestId('x-shielded-LizWiz')).toHaveText(/shielded/i);
  const dim = await liz.locator('.x-target-who').evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(dim).toBeLessThan(1);
  for (const name of ['Newt', 'Gecko']) {
    await expect(page.getByTestId(`x-target-${name}`)).toBeEnabled();
    await expect(page.getByTestId(`x-shielded-${name}`)).toHaveCount(0);
  }

  await liz.click({ force: true });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xt), 'tapping the shielded player picks nothing').toBeNull();

  await page.getByTestId('x-target-Gecko').click();
  await expect.poll(() => page.evaluate(() => window.__xt)).toEqual({ x: 1, target: 'Gecko' });
  expect(errors, errors.join('\n')).toEqual([]);
});
