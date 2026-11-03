import { test } from '@playwright/test';

test.describe('Lizard Wizard UI Screenshots', () => {
  test.setTimeout(60000);

  test('capture UI screenshots', async ({ page }) => {
    await page.goto('/');

    // Screenshot 1: Initial load (loading screen)
    await page.waitForTimeout(2000);
    await page.screenshot({ 
      path: 'screenshots/01-initial-load.png',
      fullPage: true 
    });

    // Wait for possible board render (may timeout, that's ok)
    try {
      await page.waitForSelector('#board-canvas', { timeout: 30000 });
      await page.waitForTimeout(3000); // Let board render
      
      // Screenshot 2: Board view
      await page.screenshot({ 
        path: 'screenshots/02-board-view.png',
        fullPage: true 
      });

      // Screenshot 3: Try tapping center for mats
      await page.click('#board-canvas', { position: { x: 50, y: 400 } });
      await page.waitForTimeout(1000);
      await page.screenshot({ 
        path: 'screenshots/03-tap-board.png',
        fullPage: true 
      });

      // Check if mats opened
      const matsVisible = await page.locator('#mats-overlay:not(.hidden)').isVisible().catch(() => false);
      if (matsVisible) {
        await page.screenshot({ 
          path: 'screenshots/04-mats-overlay.png',
          fullPage: true 
        });
      }
      
    } catch (error) {
      console.log('Board not fully loaded, capturing current state:', error.message);
      await page.screenshot({ 
        path: 'screenshots/02-partial-load.png',
        fullPage: true 
      });
    }
  });
});
