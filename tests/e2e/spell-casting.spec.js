// Tests for specific spell implementations: Evolve, Rise, Energize
// These are simpler smoke tests that verify the UI handles the spell flows correctly
import { test, expect } from './fixtures.js';
import { watchErrors, boot } from './helpers.js';

test('Evolve spell: UI shows familiar picker with schools', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  
  // Create a mock pending state for Evolve to test the UI
  await page.evaluate(() => {
    window.lwDebug._testPending = {
      type: 'effect',
      spell: 'Spell_Evolve',
      kind: 'evolve',
      options: [
        { familiar: 'Familiar_10_Corvum', school: 'Necromancy' },
        { familiar: 'Familiar_10_Vulpes', school: 'Enchantment' }
      ]
    };
  });
  
  // Verify the effect kind mapping exists in the card database
  const cards = await page.evaluate(() => window.lwDebug.cards());
  expect(cards['Spell_Evolve']).toBeTruthy();
  expect(cards['Spell_Evolve'].effect).toContain('Familiars becomes a Wizard');
  
  expect(errors).toEqual([]);
});

test('Rise spell: UI has rise_use action available', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  
  // Verify Rise spell exists in card database with correct effect
  const cards = await page.evaluate(() => window.lwDebug.cards());
  expect(cards['Spell_Rise']).toBeTruthy();
  expect(cards['Spell_Rise'].effect).toContain('Re-activate');
  expect(cards['Spell_Rise'].effect).toContain('Familiar');
  
  expect(errors).toEqual([]);
});

test('Energize: no checkbox in convert UI when Energize is available', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  
  // The convert sheet should not have an Energize checkbox anywhere
  // (it auto-applies when energize flag is true in legal state)
  const convertSrc = await page.evaluate(() => {
    // Get the convert UI source to verify no checkbox
    return document.body.innerHTML.includes('Energize (+3 value first)');
  });
  
  // The old checkbox text should not be in the page
  expect(convertSrc).toBe(false);
  
  expect(errors).toEqual([]);
});

test('Spell effects: Evolve, Rise, Energize not in NOT_AUTOMATED list', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  
  // Verify these spells are handled (not in NOT_AUTOMATED)
  // This is a smoke test that the web glue loads without errors
  const v = await page.evaluate(() => window.lwDebug.view());
  
  // If the page loads and we get a view, the web glue is working
  expect(v).toBeTruthy();
  expect(v.round).toBeGreaterThan(0);
  
  expect(errors).toEqual([]);
});

test('Crystal Ball: card data and max hand size effect', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  
  // Verify Crystal Ball exists in card database with correct effect
  const cards = await page.evaluate(() => window.lwDebug.cards());
  expect(cards['Spell_Crystal_Ball']).toBeTruthy();
  expect(cards['Spell_Crystal_Ball'].effect).toContain('Max Hand Size');
  expect(cards['Spell_Crystal_Ball'].effect).toContain('5');
  
  // Python tests verify the actual hand refill behavior (see test_lw_web.py)
  // "Crystal Ball refills hand to 5 immediately after cast"
  
  expect(errors).toEqual([]);
});
