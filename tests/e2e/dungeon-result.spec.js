// Dungeon result: the "Collected" total equals the gold printed on the kept treasure cards shown under it;
// gold the engine adds on top (Treasure spell +2, Block spells +1 per blocked monster) is shown as its own line.
import { test, expect } from './fixtures.js';

test.use({ viewport: { width: 430, height: 775 } });

async function render(page, was) {
  await page.evaluate((w) => {
    const ov = window.ui.openOverlay('dungeon', { testid: 'dungeon' });
    window.ui.renderDungeonResult(ov, w);
  }, was);
  await expect(page.getByTestId('dungeon-result-panel')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
});

test('Collected total matches the shown cards; spell bonus is listed separately', async ({ page }) => {
  await render(page, {
    drawn_cards: [{ type: 'Treasure', subtype: 'Gold', gold: 1 }, { type: 'Monster', monster_type: 'Goblinoid' }, { type: 'Treasure', subtype: 'Gold', gold: 1 }],
    bonus_gold: 2,
    kept: ['Dungeon_Gold1_a', 'Dungeon_Gold1_b'],
  });
  await expect(page.getByTestId('dungeon-result').locator('.log-value-number')).toHaveText('2');
  await expect(page.getByTestId('dungeon-bonus')).toContainText('Spell bonus');
  await expect(page.getByTestId('dungeon-bonus').locator('.log-value-number')).toHaveText('2');
  await expect(page.locator('.dungeon-loot img')).toHaveCount(2);
});

test('no bonus line without bonus gold; items follow the gold', async ({ page }) => {
  await render(page, {
    drawn_cards: [{ type: 'Treasure', subtype: 'Gold', gold: 2 }, { type: 'Treasure', subtype: 'Gold', gold: 1 }, { type: 'Treasure', subtype: 'Item', name: 'Necklace' }],
    bonus_gold: 0,
    kept: ['Dungeon_Gold2_a', 'Dungeon_Gold1_a', 'Dungeon_Necklace'],
  });
  const result = page.getByTestId('dungeon-result');
  await expect(result.locator('.log-value-number')).toHaveText('3');
  await expect(result).toContainText('+ Necklace');
  await expect(page.getByTestId('dungeon-bonus')).toHaveCount(0);
});
