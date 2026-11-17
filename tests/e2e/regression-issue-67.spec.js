import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// Issue #67: Keith's round-20 save. In round 19 Newt summoned Vulpes (use: gather) and cast Mana Drain with the
// gathered reagents. The save logs the cast before the summon, which read as two Newt turns.
const SAVE = fs.readFileSync('tests/regression/fixtures/issue-67.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

test('issue #67: a familiar gather and its cast read as one Newt move in the Chronicle', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), SAVE);
  await boot(page);
  await page.evaluate(() => window.ui.openLog(window.lwDebug._g));
  const log = page.getByTestId('log');
  await expect(log.locator('.log-item').last()).toBeVisible();

  await expect(log.locator('.log-item', { hasText: /^Newt cast Mana Drain/ })).toHaveCount(0);
  const entry = log.locator('.log-item', { hasText: 'Newt summoned Vulpes' });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('and cast Mana Drain');
  await expect(entry.getByTestId('log-cast').locator('img')).toHaveAttribute('alt', 'Spell_Mana_Drain');
});
