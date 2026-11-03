import { test } from '@playwright/test';

test('Diagnose 404 errors', async ({ page }) => {
  test.setTimeout(120000);
  
  const urls404 = [];
  
  page.on('response', response => {
    if (response.status() === 404) {
      urls404.push(response.url());
    }
  });

  await page.goto('/');
  
  console.log('Waiting for game to load...');
  await page.waitForTimeout(15000); // Wait for load and render attempts
  
  console.log(`\n=== Found ${urls404.length} 404 errors ===`);
  const unique = [...new Set(urls404)];
  console.log(`Unique URLs: ${unique.length}`);
  unique.forEach(url => {
    console.log(`  ${url}`);
  });
  
  await page.screenshot({ path: 'screenshots/diagnose-board.png', fullPage: true });
});
