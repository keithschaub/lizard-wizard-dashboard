// Test for Evolve and Rise spells
import { test, expect } from './fixtures.js';
import { watchErrors, boot, view, cards, me, untilMyAction } from './helpers.js';

test('Evolve spell: familiar picker appears and familiar becomes wizard', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  
  // Create a test state where Keith has Evolve and a familiar
  const initialView = await view(page);
  
  // Use lwDebug to set up a state with Evolve spell cast and a familiar
  await page.evaluate(() => {
    const g = window.lwGame;
    const s = g.state();
    const keith = s.players.find(p => p.name === 'Keith');
    
    // Add a familiar (Corvum - Necromancy)
    keith.familiars = ['assets/Familiar_10_Corvum.jpg'];
    
    // Add Evolve spell as cast
    keith.spells = keith.spells || [];
    keith.spells.push({ img: 'assets/Spell_Evolve.jpg', cast: true });
    
    // Set up a pending effect for Evolve
    s.meta.web_pending = {
      type: 'effect',
      spell: 'Spell_Evolve',
      kind: 'evolve',
      queue: []
    };
    
    g.load(JSON.stringify(s));
  });
  
  // Refresh the view
  await page.reload();
  const v = await view(page);
  
  // Check that the effect chooser shows up
  expect(v.pending?.type).toBe('effect');
  expect(v.pending?.kind).toBe('evolve');
  
  // The familiar picker should be visible
  await expect(page.getByTestId('effect')).toBeVisible();
  
  // Click on the familiar
  await page.getByTestId('evolve-Familiar_10_Corvum').click();
  
  // Wait for the effect to resolve
  await page.waitForTimeout(500);
  const v2 = await view(page);
  
  // The familiar should be gone
  const keith = v2.players.find(p => p.you);
  expect(keith.familiars.some(f => f.includes('Corvum'))).toBe(false);
  
  // A Necromancy wizard should be added
  expect(keith.wizards.some(w => w.includes('Draco_Mortemus'))).toBe(true);
  
  expect(errors).toEqual([]);
});

test('Rise spell: familiar picker appears and can be used for scoring', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  
  // Set up a state with Rise cast and a familiar
  await page.evaluate(() => {
    const g = window.lwGame;
    const s = g.state();
    const keith = s.players.find(p => p.name === 'Keith');
    
    // Add a familiar (Corvum - Necromancy)
    keith.familiars = ['assets/Familiar_10_Corvum.jpg'];
    
    // Add a necromancy wizard for school counting
    keith.wizards = ['assets/Wizard_Draco_Mortemus.jpg'];
    
    // Add Rise spell as cast
    keith.spells = keith.spells || [];
    keith.spells.push({ img: 'assets/Spell_Rise.jpg', cast: true });
    
    const initialGold = keith.gold || 0;
    
    // Set up a pending effect for Rise
    s.meta.web_pending = {
      type: 'effect',
      spell: 'Spell_Rise',
      kind: 'rise',
      queue: []
    };
    
    g.load(JSON.stringify(s));
  });
  
  // Refresh the view
  await page.reload();
  const v = await view(page);
  
  // Check that the effect chooser shows up
  expect(v.pending?.type).toBe('effect');
  expect(v.pending?.kind).toBe('rise');
  
  // The familiar picker should be visible
  await expect(page.getByTestId('effect')).toBeVisible();
  
  // Click on the familiar
  await page.getByTestId('rise-Familiar_10_Corvum').click();
  
  // Wait for the effect to resolve
  await page.waitForTimeout(500);
  const v2 = await view(page);
  
  // The familiar should still be there
  const keith = v2.players.find(p => p.you);
  expect(keith.familiars.some(f => f.includes('Corvum'))).toBe(true);
  
  // Gold should have increased (1 wizard + 1 familiar = 2 necromancy cards)
  const goldGain = (keith.gold || 0) - (v.players.find(p => p.you).gold || 0);
  expect(goldGain).toBeGreaterThanOrEqual(2);
  
  expect(errors).toEqual([]);
});
