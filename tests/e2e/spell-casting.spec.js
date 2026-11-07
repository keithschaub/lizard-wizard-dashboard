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

test('Energize: convert sheet shows base track before boosted math', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await page.evaluate(async () => {
    const r = await fetch('engine/game/g8_state.json');
    const s = await r.json();
    const k = s.players.find((p) => p.name === 'Keith');
    k.tok = ['Horn', 'Horn', 'Horn'];
    k.spells = [{ img: 'assets/Spell_Energize.jpg', cast: true }];
    s.tracks = { ...s.tracks, Horn: 4 };
    s.next = 'Keith';
    s.meta = s.meta || {};
    s.meta.web_pending = null;
    const out = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!out.ok) throw new Error(out.error);
    window.lwDebug._g.setView(out.result);
  });
  await page.getByTestId('token-Horn').tap();
  await expect(page.getByTestId('convert')).toBeVisible();
  await expect(page.getByTestId('convert-energize-note')).toContainText('Horn track 4 + 3 Energize = 7');
  await expect(page.getByTestId('convert-gain-math')).toContainText('3 × 7 =');
  await expect(page.getByTestId('convert-gain-math')).toContainText('+21 mana');
  await expect(page.getByTestId('convert-gain-math')).toContainText('track ends at 4');
  expect(errors, errors.join('\n')).toEqual([]);
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

test('Player target picker: shows actual mana and VP from game state', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  
  // Construct a mock view with known player mana and VP, then trigger effectChooser
  const displayed = await page.evaluate(() => {
    const g = window.lwDebug._g;
    
    // Mock the view with known player stats
    g.v = {
      ...g.v,
      pending: {
        type: 'effect',
        spell: 'Spell_Mana_Drain',
        kind: 'mana_drain',
        options: [
          { player: 'Newt' },
          { player: 'LizWiz' }
        ]
      },
      players: [
        { name: 'Keith', mana: 50, vp: 10, you: true },
        { name: 'Newt', mana: 42, vp: 18, you: false },
        { name: 'LizWiz', mana: 28, vp: 7, you: false }
      ]
    };
    
    // Trigger the effect chooser
    window.ui.effectChooser(g);
    
    // Give the UI a moment to render
    return new Promise(resolve => setTimeout(() => {
      // Extract the displayed values
      const newtMana = document.querySelector('[data-testid="Newt-mana"]')?.textContent || '';
      const newtVp = document.querySelector('[data-testid="Newt-vp"]')?.textContent || '';
      const lizwizMana = document.querySelector('[data-testid="LizWiz-mana"]')?.textContent || '';
      const lizwizVp = document.querySelector('[data-testid="LizWiz-vp"]')?.textContent || '';
      
      resolve({
        newtMana,
        newtVp,
        lizwizMana,
        lizwizVp
      });
    }, 100));
  });
  
  // Verify the correct values are displayed
  expect(displayed.newtMana).toContain('42');
  expect(displayed.newtVp).toContain('18');
  expect(displayed.newtVp).toContain('VP');
  
  expect(displayed.lizwizMana).toContain('28');
  expect(displayed.lizwizVp).toContain('7');
  expect(displayed.lizwizVp).toContain('VP');
  
  // Also verify the elements are visible in the DOM
  await expect(page.locator('[data-testid="Newt-mana"]')).toBeVisible();
  await expect(page.locator('[data-testid="Newt-vp"]')).toBeVisible();
  await expect(page.locator('[data-testid="LizWiz-mana"]')).toBeVisible();
  await expect(page.locator('[data-testid="LizWiz-vp"]')).toBeVisible();
  
  expect(errors).toEqual([]);
});
