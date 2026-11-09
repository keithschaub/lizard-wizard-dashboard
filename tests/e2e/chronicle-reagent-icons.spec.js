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
      ],
    });
    await window.ui.openLog(g);
  });

  const log = page.getByTestId('log');
  await expect(log).toBeVisible();
  await expect(log.locator('.log-item')).toHaveCount(3);
  await expect(log.locator('.log-track-label')).toHaveText('TRACKS UP');
  await expect(log.locator('.log-track-chip')).toHaveCount(2);
  await expect(log.locator('.log-gather-details .log-reagent-chip.bonus')).toHaveCount(1);
  await expect(log.locator('.log-item').nth(0).locator('.log-inline-text')).toHaveText('Keith gathered');
  await expect(log.locator('.log-item').nth(0).locator('.log-inline .log-reagent-chip')).toHaveCount(1);
  await expect(log.locator('.log-item').nth(0).locator('.log-inline .log-reagent-count')).toHaveText('×2');
  await expect(log.locator('.log-item').nth(1)).toContainText('Keith built Obelisk of Puzzles paying');
  await expect(log.locator('.log-item').nth(1).locator('.log-school-chip')).toContainText('T2 Thaumaturgy');
  await expect(log.locator('.log-item').nth(1).locator('.log-reagent-chip')).toHaveCount(1);
  await expect(log.locator('.log-item').nth(2)).toContainText('Keith cast Mana Fountain');
  await expect(log.locator('.log-item').nth(2).locator('.log-school-chip')).toContainText('Thaumaturgy');
  await expect(log.locator('.log-item').nth(2)).not.toContainText('Foxglove, Foxglove');
  await expect(log.locator('.log-item').nth(2).locator('.log-reagent-chip')).toHaveCount(2);
  await expect(log.locator('.log-item').nth(2).locator('.log-reagent-count').nth(0)).toHaveText('×2');
  await expect(log.locator('.log-reagent-chip').first()).toHaveAttribute('aria-label', 'Sulphur ×2');
  const grouped = await page.evaluate(() => window.ui.groupReagents(['Sulphur', 'Foxglove', 'Sulphur']));
  expect(grouped).toEqual([
    { reagent: 'Sulphur', count: 2 },
    { reagent: 'Foxglove', count: 1 },
  ]);
  const gatherTextBox = await log.locator('.log-item').nth(0).locator('.log-inline-text').boundingBox();
  const gatherChipBox = await log.locator('.log-item').nth(0).locator('.log-inline .log-reagent-chip').first().boundingBox();
  expect(Math.abs(gatherTextBox.y - gatherChipBox.y)).toBeLessThan(12);
  await log.screenshot({ path: 'docs/screenshots/chronicle-reagent-icons-430x775.png' });
});
