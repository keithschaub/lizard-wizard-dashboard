import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

test('Chronicle renders structured reagent icons for gather, build, and cast entries', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const g = window.lwDebug._g;
    g.call = async () => ({
      result: [
        {
          r: 4, who: 'Keith', act: 'gather', text: 'Keith gathered Sulphur, Sulphur; tracks up: Nightshade, Nightshade, Horn',
          gather: { reagents: ['Sulphur', 'Sulphur'], bonus: ['Sulphur'], tracks: ['Nightshade', 'Nightshade', 'Horn'] },
        },
        {
          r: 5, who: 'Keith', act: 'build', text: 'Keith built Obelisk of Puzzles T2 (Thaumaturgy) paying Sulphur, Sulphur',
          reagents: ['Sulphur', 'Sulphur'], school: 'Thaumaturgy', tier: 2, cards: ['Tower_T1_Ivory_Spire'],
        },
        {
          r: 5, who: 'Keith', act: 'cast', text: 'Keith cast Mana Fountain (Thaumaturgy) (Foxglove, Foxglove, Sulphur, Sulphur)',
          reagents: ['Foxglove', 'Foxglove', 'Sulphur', 'Sulphur'], school: 'Thaumaturgy',
          cast: 'Spell_Mana_Fountain', cards: ['Spell_Mana_Fountain'],
        },
        {
          r: 5, who: 'Rex', act: 'auction', text: 'Rex won the auction for Anguis Magicus for 8 mana',
          school: 'Sorcery', values: [{ kind: 'mana', value: -8 }],
          cards: ['Wizard_Anguis_Magicus'],
        },
      ],
    });
    await window.ui.openLog(g);
  });

  const log = page.getByTestId('log');
  await expect(log).toBeVisible();
  await expect(log.locator('.log-item')).toHaveCount(4);
  await expect(log.locator('.log-track-label')).toHaveText('TRACKS UP');
  await expect(log.locator('.log-track-chip')).toHaveCount(2);
  await expect(log.locator('.log-gather-details .log-reagent-chip.bonus')).toHaveCount(0);
  await expect(log.locator('.log-item').nth(0).locator('.log-inline-text')).toHaveText('Keith gathered');
  await expect(log.locator('.log-item').nth(0).locator('.log-inline .log-reagent-chip')).toHaveCount(1);
  await expect(log.locator('.log-item').nth(0).locator('.log-inline .log-reagent-count')).toHaveText('×3');
  await expect(log.locator('.log-item').nth(1).locator('.log-inline-text')).toHaveText('Keith built Obelisk of Puzzles');
  await expect(log.locator('.log-item').nth(1)).toContainText('paying');
  await expect(log.locator('.log-item').nth(1).locator('.log-school-chip')).toContainText('T2 Thaumaturgy');
  await expect(log.locator('.log-item').nth(1).locator('.log-reagent-chip')).toHaveCount(1);
  await expect(log.locator('.log-item').nth(2)).toContainText('Keith cast Mana Fountain');
  await expect(log.locator('.log-item').nth(2).locator('.log-school-chip')).toContainText('Thaumaturgy');
  await expect(log.locator('.log-item').nth(2)).not.toContainText('Foxglove, Foxglove');
  await expect(log.locator('.log-item').nth(2).locator('.log-reagent-chip')).toHaveCount(2);
  await expect(log.locator('.log-item').nth(2).locator('.log-reagent-count').nth(0)).toHaveText('×2');
  await expect(log.locator('.log-reagent-chip').first()).toHaveAttribute('aria-label', 'Sulphur ×3');
  await expect(log.locator('.log-item').nth(3).locator('.log-school-chip')).toContainText('Sorcery');
  await expect(log.locator('.log-item').nth(3).locator('.log-value-chip')).toHaveCount(1);
  await expect(log.locator('.log-item').nth(3).locator('.log-value-number')).toHaveText('−8');
  await expect(log.locator('.log-item').nth(3)).toContainText('Rex won the auction for Anguis Magicus');
  await expect(log.locator('.log-item').nth(3)).not.toContainText('auction for Anguis Magicus for 8 mana');
  await expect(log.locator('.log-item').nth(2).locator('.log-reagent-count')).toHaveCount(2);
  const grouped = await page.evaluate(() => window.ui.groupReagents(['Sulphur', 'Foxglove', 'Sulphur'], ['Sulphur', 'Horn']));
  expect(grouped).toEqual([
    { reagent: 'Sulphur', count: 3, bonus: true },
    { reagent: 'Foxglove', count: 1, bonus: false },
    { reagent: 'Horn', count: 1, bonus: true },
  ]);
  const gatherTextBox = await log.locator('.log-item').nth(0).locator('.log-inline-text').boundingBox();
  const gatherChipBox = await log.locator('.log-item').nth(0).locator('.log-inline .log-reagent-chip').first().boundingBox();
  expect(Math.abs(gatherTextBox.y - gatherChipBox.y)).toBeLessThan(12);
  await log.screenshot({ path: 'docs/screenshots/chronicle-reagent-icons-430x775.png' });
});

test('Chronicle action lines keep schools and values in the approved chip order', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const g = window.lwDebug._g;
    g.call = async () => ({
      result: [
        {
          r: 24, who: 'Gecko', act: 'summon', use: 'gather',
          text: 'Gecko summoned Vulpes', school: 'Conjuring',
          reagents: ['Horn', 'Horn', 'Horn', 'Horn', 'Horn'],
          values: [{ kind: 'mana', value: -15 }],
        },
        {
          r: 24, who: 'Newt', act: 'convert', text: 'Newt sold',
          reagents: Array(9).fill('Mandrake'), values: [{ kind: 'mana', value: 63 }],
        },
        {
          r: 24, who: 'LizWiz', act: 'build',
          text: 'LizWiz built Obelisk of Puzzles paying',
          reagents: ['Sulphur', 'Sulphur'], school: 'Thaumaturgy', tier: 2,
        },
        {
          r: 24, who: 'LizWiz', act: 'build',
          text: 'LizWiz built Obelisk of Puzzles paying',
          school: 'Thaumaturgy', tier: 2, values: [{ kind: 'gold', value: -3 }],
        },
        {
          r: 24, who: 'Newt', act: 'cast',
          text: 'Newt cast Anguis Magicus (Sorcery) is out of play', school: 'Sorcery',
        },
        {
          r: 24, who: 'Newt', act: 'swapo',
          text: 'Newt swapped: gave Draco Mortemus (Enchantment), took Anguis Magicus (Sorcery)',
          schools: ['Enchantment', 'Sorcery'],
        },
      ],
    });
    await window.ui.openLog(g);
  });
  const items = page.getByTestId('log-item');
  await expect(items).toHaveCount(6);
  await expect(items.nth(0)).toContainText('Gecko summoned Vulpes');
  await expect(items.nth(0)).toContainText('gathered');
  await expect(items.nth(0).locator('.log-reagent-count')).toHaveText('×5');
  await expect(items.nth(0).locator('.log-value-number')).toHaveText('−15');
  await expect(items.nth(1)).toContainText('Newt sold');
  await expect(items.nth(1)).toContainText('for');
  await expect(items.nth(1).locator('.log-reagent-count')).toHaveText('×9');
  await expect(items.nth(1).locator('.log-value-number')).toHaveText('63');
  await expect(items.nth(2).locator('.log-school-chip')).toContainText('T2 Thaumaturgy');
  await expect(items.nth(2).locator('.log-inline-text')).toHaveText('LizWiz built Obelisk of Puzzles');
  await expect(items.nth(2)).toContainText('paying');
  await expect(items.nth(3)).not.toContainText('Gold');
  await expect(items.nth(3).locator('.log-value-number')).toHaveText('−3');
  await expect(items.nth(4)).not.toContainText('(Sorcery)');
  await expect(items.nth(4).locator('.log-school-chip')).toContainText('Sorcery');
  await expect(items.nth(5)).not.toContainText('(Enchantment)');
  await expect(items.nth(5)).not.toContainText('(Sorcery)');
  await expect(items.nth(5).locator('.log-school-chip')).toHaveCount(2);
  await page.getByTestId('log').screenshot({ path: 'docs/screenshots/chronicle-lines-430x775.png' });
});
