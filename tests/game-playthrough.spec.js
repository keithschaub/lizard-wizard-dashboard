import { test, expect } from '@playwright/test';

test.describe('Lizard Wizard Mobile Playthrough', () => {
  test.setTimeout(300000); // 5 minutes for full playthrough

  test('loads game and takes screenshots', async ({ page }) => {
    // Navigate to the game
    await page.goto('/');

    // Wait for loading to complete (Pyodide takes time)
    await page.waitForSelector('#game-container:not(.hidden)', { timeout: 120000 });

    // Screenshot 1: Board view
    await page.waitForTimeout(2000); // Let board render
    await page.screenshot({ 
      path: 'screenshots/01-board.png',
      fullPage: true 
    });

    // Screenshot 2: Tap board to show mats overlay
    await page.click('#board-canvas', { position: { x: 50, y: 400 } });
    await page.waitForSelector('#mats-overlay:not(.hidden)', { timeout: 5000 });
    await page.screenshot({ 
      path: 'screenshots/02-mats-overlay.png',
      fullPage: true 
    });

    // Close mats
    await page.click('.close-btn');
    await page.waitForTimeout(500);

    // Screenshot 3: Expand a card
    // Try to tap a face-up spell
    const hasSpells = await page.locator('#board-canvas').isVisible();
    if (hasSpells) {
      // Tap center-ish area where spells should be
      await page.click('#board-canvas', { position: { x: 450, y: 250 } });
      await page.waitForTimeout(1000);
      
      // Check if card expanded
      const cardExpanded = await page.locator('#card-expand:not(.hidden)').isVisible().catch(() => false);
      if (cardExpanded) {
        await page.screenshot({ 
          path: 'screenshots/03-card-expand.png',
          fullPage: true 
        });
        
        // Close card
        await page.click('#card-expand');
        await page.waitForTimeout(500);
      }
    }

    // Screenshot 4: Tap reagent deck to start gathering
    await page.click('#board-canvas', { position: { x: 100, y: 100 } });
    await page.waitForTimeout(1000);
    
    const gatherUIVisible = await page.locator('#gather-ui:not(.hidden)').isVisible().catch(() => false);
    if (gatherUIVisible) {
      await page.screenshot({ 
        path: 'screenshots/04-gathering.png',
        fullPage: true 
      });
      
      // Try to select reagents (tap on icons)
      const reagentOptions = await page.locator('.reagent-option').count();
      if (reagentOptions > 0) {
        // Tap first 3 reagents
        for (let i = 0; i < Math.min(3, reagentOptions); i++) {
          await page.locator('.reagent-option').nth(i).click();
          await page.waitForTimeout(200);
        }
        
        await page.screenshot({ 
          path: 'screenshots/05-gathering-selected.png',
          fullPage: true 
        });
      }
    }

    // Screenshot 5: Action log
    const logToggle = await page.locator('#log-toggle').isVisible();
    if (logToggle) {
      await page.click('#log-toggle');
      await page.waitForTimeout(500);
      await page.screenshot({ 
        path: 'screenshots/06-action-log.png',
        fullPage: true 
    });
    }

    // Verify game state loaded
    const roundNum = await page.textContent('#round-num').catch(() => '0');
    expect(parseInt(roundNum)).toBeGreaterThan(0);
  });

  test('verifies core UI elements exist', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#game-container:not(.hidden)', { timeout: 120000 });

    // Check essential UI elements
    await expect(page.locator('#board-canvas')).toBeVisible();
    await expect(page.locator('#mute-toggle')).toBeVisible();
    await expect(page.locator('#round-num')).toBeVisible();
    await expect(page.locator('#menu-btn')).toBeVisible();
    await expect(page.locator('#action-log')).toBeVisible();
  });
});
