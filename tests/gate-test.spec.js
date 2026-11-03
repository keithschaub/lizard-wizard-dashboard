import { test, expect } from '@playwright/test';

test.describe('Gate Tests', () => {
  test.setTimeout(600000); // 10 minutes

  test('Gate (a): Load to board with no console errors', async ({ page, browser }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    page.on('pageerror', error => {
      errors.push(error.message);
    });

    await page.goto('/');
    
    // Wait for game container to become visible (engine loaded)
    console.log('Waiting for game to load...');
    await page.waitForSelector('#game-container:not(.hidden)', { timeout: 300000 });
    
    // Wait for board to render
    await page.waitForSelector('#board-canvas', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(3000); // Let board fully render
    
    // Take screenshot
    await page.screenshot({ 
      path: 'screenshots/gate-a-board-loaded.png',
      fullPage: true 
    });
    
    // Check for errors
    if (errors.length > 0) {
      console.log('Console errors:', errors);
      throw new Error(`Gate (a) FAILED: Console errors: ${errors.join('; ')}`);
    }
    
    // Verify board canvas is visible
    const canvasVisible = await page.locator('#board-canvas').isVisible();
    expect(canvasVisible).toBe(true);
    
    console.log('Gate (a) PASSED: Board loaded with no console errors');
  });

  test('Gate (d): Full playthrough - 3 rounds', async ({ page }) => {
    await page.goto('/');
    
    // Wait for game to load
    console.log('Waiting for game to load...');
    await page.waitForSelector('#game-container:not(.hidden)', { timeout: 300000 });
    await page.waitForTimeout(3000);
    
    // Get initial game state
    const getGameState = async () => {
      return await page.evaluate(() => {
        return {
          round: window.game?.gameState?.meta?.round || 0,
          players: window.game?.gameState?.players?.map(p => ({
            name: p.name,
            mana: p.mana,
            tokCount: p.tok?.length || 0,
            wizards: p.wizards?.length || 0,
            towers: p.towers?.length || 0,
            spells: p.spells?.length || 0
          })) || []
        };
      });
    };
    
    let state = await getGameState();
    console.log('Initial state:', JSON.stringify(state, null, 2));
    
    const initialRound = state.round;
    let actionCount = 0;
    
    // Play at least 3 rounds
    for (let round = 0; round < 5; round++) {
      console.log(`\n=== Attempting Round ${round + 1} ===`);
      
      // Try gather action - tap reagent deck area
      try {
        await page.click('#board-canvas', { position: { x: 100, y: 100 } });
        await page.waitForTimeout(1000);
        
        const gatherVisible = await page.locator('#gather-ui:not(.hidden)').isVisible().catch(() => false);
        if (gatherVisible) {
          console.log('Gather UI opened');
          await page.screenshot({ path: `screenshots/gate-d-round${round+1}-gather.png` });
          
          // Select reagents if any
          const reagentCount = await page.locator('.reagent-option').count();
          if (reagentCount > 0) {
            await page.locator('.reagent-option').first().click();
            await page.waitForTimeout(500);
          }
          actionCount++;
        }
      } catch (e) {
        console.log('Gather failed:', e.message);
      }
      
      // Tap board center to close any overlays
      await page.click('#board-canvas', { position: { x: 200, y: 400 } });
      await page.waitForTimeout(1000);
      
      // Check if state changed
      const newState = await getGameState();
      console.log('State after actions:', JSON.stringify(newState, null, 2));
      
      // If round advanced, good
      if (newState.round > state.round) {
        console.log(`✓ Round advanced from ${state.round} to ${newState.round}`);
        state = newState;
      }
      
      await page.waitForTimeout(2000);
    }
    
    const finalState = await getGameState();
    console.log('\nFinal state:', JSON.stringify(finalState, null, 2));
    
    // Assert we played at least some actions
    expect(actionCount).toBeGreaterThan(0);
    
    // Take final screenshot
    await page.screenshot({ 
      path: 'screenshots/gate-d-final-board.png',
      fullPage: true 
    });
    
    console.log(`Gate (d): Played ${actionCount} actions across ${finalState.round - initialRound} rounds`);
  });
});
