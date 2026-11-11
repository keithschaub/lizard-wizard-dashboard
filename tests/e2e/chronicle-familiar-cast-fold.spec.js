import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// fixtures/familiar-cast-fold.json: round 6, Newt summons Nympharum (use: gather) and the
// familiar's Bloom cast is logged first as its own `cast` entry.
const SAVE = fs.readFileSync('tests/e2e/fixtures/familiar-cast-fold.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

test('Chronicle folds a familiar-enabled cast into its summon entry', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), SAVE);
  await boot(page);
  await page.evaluate(() => window.ui.openLog(window.lwDebug._g));
  const log = page.getByTestId('log');
  await expect(log.locator('.log-item').last()).toBeVisible();

  await expect(log.locator('.log-item', { hasText: /^Newt cast Bloom/ })).toHaveCount(0);
  const entry = log.locator('.log-item', { hasText: 'Newt summoned Nympharum' });
  await expect(entry).toHaveCount(1);
  const text = (await entry.innerText()).replace(/\s+/g, ' ');
  const order = ['summoned Nympharum', 'Druidry', 'paying', '10', 'gathered', '×4', 'and cast Bloom', 'Druidry', 'paying', '×3'];
  let at = 0;
  for (const part of order) {
    const next = text.indexOf(part, at);
    expect(next, `"${part}" after offset ${at} in "${text}"`).toBeGreaterThanOrEqual(0);
    at = next + part.length;
  }
  await expect(entry.locator('.log-inline-and-cast .log-reagent-chip')).toHaveCount(1);
  await expect(entry.locator('.log-inline-and-cast .log-reagent-count')).toHaveText('×3');
  await expect(entry.getByTestId('log-cast')).toHaveCount(1);
  await expect(entry.getByTestId('log-cast').locator('img')).toHaveAttribute('alt', 'Spell_Bloom');
  await expect(entry.locator('.thumbs img')).toHaveCount(1);
  await expect(entry.locator('.thumbs img')).toHaveAttribute('alt', 'Familiar_10_Nympharum');
  await expect(entry).not.toContainText('·');
});

test('Chronicle keeps ordinary casts as their own entries', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const g = window.lwDebug._g;
    const bloom = { act: 'cast', text: 'cast Bloom (Druidry) (Toadstool, Toadstool, Toadstool)', cards: ['Spell_Bloom'],
      school: 'Druidry', reagents: ['Toadstool', 'Toadstool', 'Toadstool'], cast: 'Spell_Bloom' };
    const summon = { act: 'summon', use: 'gather', text: 'Newt summoned Nympharum 10 (Druidry)', school: 'Druidry',
      values: [{ kind: 'mana', value: -10 }], reagents: ['Toadstool', 'Toadstool', 'Toadstool', 'Toadstool'] };
    g.call = async () => ({
      result: [
        // Another player's cast, and Newt's cast from an earlier round, are not the familiar's.
        { ...bloom, r: 5, who: 'Newt', text: `Newt ${bloom.text}` },
        { ...bloom, r: 6, who: 'Rex', text: `Rex ${bloom.text}` },
        { ...summon, r: 6, who: 'Newt', cards: ['Familiar_10_Nympharum', 'Spell_Bloom'] },
        // A summon that enabled no cast leaves a same-round cast alone.
        { ...bloom, r: 7, who: 'Newt', text: `Newt ${bloom.text}` },
        { ...summon, r: 7, who: 'Newt', cards: ['Familiar_10_Nympharum'] },
      ],
    });
    await window.ui.openLog(g);
  });
  const log = page.getByTestId('log');
  await expect(log.locator('.log-item')).toHaveCount(5);
  await expect(log.locator('.log-inline-and-cast')).toHaveCount(0);
  await expect(log.getByTestId('log-cast')).toHaveCount(3);
});
