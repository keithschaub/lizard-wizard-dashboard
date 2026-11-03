import { test } from '@playwright/test';

test('Quick load test', async ({ page }) => {
  test.setTimeout(600000);
  
  const logs = [];
  const errors = [];
  
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') {
      errors.push(text);
    }
  });
  
  page.on('pageerror', error => {
    errors.push(`PAGE ERROR: ${error.message}`);
  });

  await page.goto('/');
  
  console.log('Waiting up to 5 minutes for game to load...');
  
  // Check every 10 seconds
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(10000);
    
    const status = await page.evaluate(() => {
      return {
        loadingVisible: !document.getElementById('loading-screen')?.classList.contains('hidden'),
        gameVisible: !document.getElementById('game-container')?.classList.contains('hidden'),
        loadingText: document.getElementById('loading-status')?.textContent || '',
        hasError: document.getElementById('loading-status')?.textContent?.includes('Failed') || false
      };
    });
    
    console.log(`[${i*10}s] Loading: ${status.loadingVisible}, Game: ${status.gameVisible}, Status: "${status.loadingText}"`);
    
    if (status.hasError) {
      console.log('ERROR DETECTED');
      console.log('Errors:', errors);
      console.log('Last 20 logs:', logs.slice(-20));
      await page.screenshot({ path: 'screenshots/quick-load-error.png', fullPage: true });
      throw new Error(`Load failed: ${status.loadingText}`);
    }
    
    if (status.gameVisible) {
      console.log('✓ Game loaded successfully!');
      await page.screenshot({ path: 'screenshots/quick-load-success.png', fullPage: true });
      console.log('Errors encountered:', errors.length);
      if (errors.length > 0) {
        console.log('Errors:', errors);
      }
      return;
    }
  }
  
  console.log('Timeout after 5 minutes');
  console.log('Final errors:', errors);
  console.log('Final logs:', logs.slice(-30));
  await page.screenshot({ path: 'screenshots/quick-load-timeout.png', fullPage: true });
  throw new Error('Game did not load in 5 minutes');
});
