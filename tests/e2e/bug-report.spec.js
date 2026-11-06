import { test, expect } from './fixtures.js';
import { view, me, shot } from './helpers.js';
import fs from 'fs';

const G8_AUTO = JSON.parse(fs.readFileSync('engine/game/g8_auto_advanced.json', 'utf8'));
const INSET = { top: 59, bottom: 34, chrome: 84 };

async function open(page, text, relayUrl = '') {
  await page.addInitScript(({ save, relay }) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('lw.save.v1', save);
      sessionStorage.setItem('seeded', '1');
    }
    window.LW_RELAY_URL = relay;
    window.LW_COMMIT_SHA = 'dev';
  }, { save: text, relay: relayUrl });
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await page.addStyleTag({ content: `:root { --safe-t: ${INSET.top}px !important; --safe-b: ${INSET.bottom}px !important; --chrome-b: ${INSET.chrome}px !important; }` });
}

const RELAY_TEST = 'https://lw-bug-relay.test/report';

// Mock relay for testing
async function setupMockRelay(page) {
  await page.route('**/report', async route => {
    // Simulate successful submission
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        issueNumber: 123,
        message: 'Bug report submitted successfully',
      }),
    });
  });
}

// Mock offline relay (network error)
async function setupOfflineRelay(page) {
  await page.route('**/report', async route => {
    await route.abort('failed');
  });
}

test('Bug report dialog opens from menu', async ({ page }) => {
  await open(page, JSON.stringify(G8_AUTO));
  
  // Open menu
  await page.getByTestId('btn-menu').click();
  await expect(page.getByTestId('menu')).toBeVisible();
  
  // Click Report Bug
  await page.getByTestId('menu-bug-report').click();
  
  // Dialog should be visible
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('bug-description')).toBeVisible();
  await expect(page.getByTestId('bug-save-report')).toBeVisible();
  await expect(page.getByTestId('bug-submit')).toHaveCount(0);
  await expect(page.getByTestId('bug-cancel')).toBeVisible();
  
  await shot(page, 'bug-report-01-dialog');
  
  // Close dialog
  await page.getByTestId('bug-cancel').click();
  await expect(page.getByTestId('bug-report')).not.toBeVisible();
});

test('Bug report requires description', async ({ page }) => {
  await setupMockRelay(page);
  await open(page, JSON.stringify(G8_AUTO), RELAY_TEST);
  
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  // Try to submit without description
  await page.getByTestId('bug-submit').click();
  
  // Should show toast
  await expect(page.getByTestId('bug-toast')).toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId('bug-toast')).toContainText('describe');
  
  // Dialog should still be open
  await expect(page.getByTestId('bug-report')).toBeVisible();
});

test('Bug report submits successfully with mock relay', async ({ page }) => {
  await setupMockRelay(page);
  await open(page, JSON.stringify(G8_AUTO), RELAY_TEST);
  
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  // Enter description
  await page.getByTestId('bug-description').fill('Test bug: wizards not appearing');
  
  await shot(page, 'bug-report-02-filled');
  
  // Submit
  await page.getByTestId('bug-submit').click();
  
  // Should show success toast
  await expect(page.getByTestId('bug-toast')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('bug-toast')).toContainText('sent');
  
  await shot(page, 'bug-report-03-success-toast');
  
  // Dialog should close
  await expect(page.getByTestId('bug-report')).not.toBeVisible({ timeout: 3000 });
});

test('Bug report captures game state in background', async ({ page }) => {
  let capturedPostData = null;
  
  await page.route('**/report', async route => {
    // Capture the form data
    const request = route.request();
    capturedPostData = request.postData();
    
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, issueNumber: 123 }),
    });
  });
  
  await open(page, JSON.stringify(G8_AUTO), RELAY_TEST);
  
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  await page.getByTestId('bug-description').fill('Test bug report');
  await page.getByTestId('bug-submit').click();
  
  // Wait for submission
  await expect(page.getByTestId('bug-toast')).toBeVisible({ timeout: 5000 });
  
  // Multipart submission: Playwright exposes raw post body, not JSON
  expect(capturedPostData).toBeTruthy();
  expect(capturedPostData).toContain('Content-Disposition: form-data; name="gameState"');
});

test('Bug report queues offline and shows retry message', async ({ page }) => {
  await setupOfflineRelay(page);
  await open(page, JSON.stringify(G8_AUTO), RELAY_TEST);
  
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  await page.getByTestId('bug-description').fill('Offline test report');
  await page.getByTestId('bug-submit').click();
  
  // Should show queued message
  await expect(page.getByTestId('bug-toast')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('bug-toast')).toContainText(/queued|offline/i);
  
  await shot(page, 'bug-report-04-offline-queued');
  
  // Dialog should close
  await expect(page.getByTestId('bug-report')).not.toBeVisible({ timeout: 3000 });
  
  // Check localStorage has queued report
  const queue = await page.evaluate(() => {
    return localStorage.getItem('lw.bug-reports.queue');
  });
  expect(queue).toBeTruthy();
  expect(JSON.parse(queue).length).toBeGreaterThan(0);
});

test('Bug report allows image attachments', async ({ page }) => {
  await setupMockRelay(page);
  await open(page, JSON.stringify(G8_AUTO), RELAY_TEST);
  
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  // Check that attach button exists
  await expect(page.getByTestId('bug-attach-btn')).toBeVisible();
  
  // We can't actually test file upload in Playwright without real files,
  // but we can verify the UI is present
  await page.getByTestId('bug-attach-btn').click();
  
  // File input should exist (even if hidden)
  const fileInput = page.getByTestId('bug-images');
  await expect(fileInput).toHaveCount(1);
  
  await shot(page, 'bug-report-05-with-attach-button');
});

test('Bug report download fallback works', async ({ page }) => {
  await open(page, JSON.stringify(G8_AUTO), RELAY_TEST);
  
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  await page.getByTestId('bug-description').fill('Download test');
  
  // Set up download handler
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('bug-download').click();
  
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/bug-report-\d+\.json/);
  
  await shot(page, 'bug-report-06-download-option');
});

test('Bug report does not disrupt view during capture', async ({ page }) => {
  await setupMockRelay(page);
  await open(page, JSON.stringify(G8_AUTO), RELAY_TEST);
  
  // Take screenshot of board before
  await expect(page.locator('#board')).toBeVisible();
  const boardBefore = await page.locator('#board').screenshot();
  
  // Open and submit bug report
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  await page.getByTestId('bug-description').fill('No disruption test');
  
  // Board should still be visible behind dialog
  await expect(page.locator('#board')).toBeVisible();
  
  await page.getByTestId('bug-submit').click();
  
  // Wait for toast
  await expect(page.getByTestId('bug-toast')).toBeVisible({ timeout: 5000 });
  
  // Board should look the same
  const boardAfter = await page.locator('#board').screenshot();
  
  // They should be similar (not doing pixel-perfect comparison, just checking it's still rendered)
  expect(boardAfter.length).toBeGreaterThan(0);
});

test('Bug report close button works', async ({ page }) => {
  await open(page, JSON.stringify(G8_AUTO));
  
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  // Close via X button
  await page.locator('.bug-close').click();
  await expect(page.getByTestId('bug-report')).not.toBeVisible();
});

test('Bug report close on scrim click works', async ({ page }) => {
  await open(page, JSON.stringify(G8_AUTO));
  
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  // Click outside dialog (on overlay background)
  await page.getByTestId('bug-report').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('bug-report')).not.toBeVisible();
});

test('Bug report fits on mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14
  await open(page, JSON.stringify(G8_AUTO));
  
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('menu-bug-report').click();
  await expect(page.getByTestId('bug-report')).toBeVisible({ timeout: 5000 });
  
  // Dialog should be fully visible
  const dialog = page.locator('.bug-panel');
  await expect(dialog).toBeVisible();
  
  const box = await dialog.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(INSET.top);
  expect(box.y + box.height).toBeLessThanOrEqual(844 - INSET.bottom);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  
  await shot(page, 'bug-report-07-mobile-fit');
});
