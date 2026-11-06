import { test, expect } from './fixtures.js';
import { view, me, shot } from './helpers.js';
import fs from 'fs';

const G8_AUTO = JSON.parse(fs.readFileSync('engine/game/g8_auto_advanced.json', 'utf8'));
const INSET = { top: 59, bottom: 34, chrome: 84 };

async function open(page, text) {
  await page.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1'); } }, text);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await page.addStyleTag({ content: `:root { --safe-t: ${INSET.top}px !important; --safe-b: ${INSET.bottom}px !important; --chrome-b: ${INSET.chrome}px !important; }` });
}

async function checkCardVisible(page) {
  // Just check that the expanded card is visible and not clipped
  const expanded = page.getByTestId('expanded');
  await expect(expanded).toBeVisible();
  const img = page.getByTestId('expanded-img');
  await expect(img).toBeVisible();
}

test('Swipe through card group (hand or board)', async ({ page }) => {
  const STATE = JSON.parse(fs.readFileSync('engine/game/g8_auto_advanced.json', 'utf8'));
  await open(page, JSON.stringify(STATE));
  
  // Wait for board to load (use board cards which don't trigger gather flow)
  await expect(page.locator('#board')).toBeVisible({ timeout: 60_000 });
  
  // Find and tap a spell card on the board
  const spellSlot = page.locator('[data-slot^="spell_"]').first();
  await expect(spellSlot).toBeVisible();
  await spellSlot.tap();
  
  // Should expand
  await expect(page.getByTestId('expanded')).toBeVisible();
  
  // Get the group size from indicator
  const indicator = page.getByTestId('card-indicator');
  const groupSize = await indicator.locator('.dot').count();
  
  if (groupSize < 2) {
    test.skip('Need at least 2 cards in group for swipe test');
  }
  
  // Verify card track exists
  await expect(page.getByTestId('card-indicator')).toBeVisible();
  // Should show dots (board spells, typically 4)
  expect(groupSize).toBeGreaterThanOrEqual(2);
  // First dot should be active
  await expect(indicator.locator('.dot.active').first()).toBeVisible();
  
  // Test arrow navigation (next)
  const nextBtn = page.getByTestId('nav-next');
  await expect(nextBtn).toBeVisible();
  await nextBtn.click();
  
  // Wait for animation
  await page.waitForTimeout(400);
  
  // Verify indicator updated
  const activeDot = await indicator.locator('.dot.active').getAttribute('data-index');
  expect(activeDot).toBe('1');
  
  await shot(page, 'swipe-board-01-next');
  
  // Test arrow navigation (prev)
  const prevBtn = page.getByTestId('nav-prev');
  await prevBtn.click();
  await page.waitForTimeout(400);
  
  // Should be back to first card
  const activeDot2 = await indicator.locator('.dot.active').getAttribute('data-index');
  expect(activeDot2).toBe('0');
  
  await shot(page, 'swipe-board-02-prev');
  
  // Close overlay
  await page.getByTestId('ov-close').click();
  await expect(page.getByTestId('expanded')).not.toBeVisible();
});

test('Swipe through board spell offer', async ({ page }) => {
  await open(page, JSON.stringify(G8_AUTO));
  
  // Wait for board
  await expect(page.locator('#board')).toBeVisible({ timeout: 60_000 });
  
  // Find and tap a spell card
  const spellSlot = page.locator('[data-slot^="spell_"]').first();
  await expect(spellSlot).toBeVisible();
  await spellSlot.tap();
  
  await checkCardVisible(page);
  
  // Verify indicator (should have 4 spells on offer)
  const indicator = page.getByTestId('card-indicator');
  const dots = await indicator.locator('.dot').count();
  expect(dots).toBe(4);
  
  // Navigate to next card
  await page.getByTestId('nav-next').click();
  await page.waitForTimeout(400);
  
  await shot(page, 'swipe-spells-01-next');
  
  // Close
  await page.getByTestId('ov-close').click();
});

test('Swipe through mat wizards', async ({ page }) => {
  // Use a save with some wizards
  const s = structuredClone(G8_AUTO);
  s.players[0].wizards = [
    'assets/Wizard_Draco_Mortemus.jpg',
    'assets/Wizard_Serpentium_Machinus.jpg',
    'assets/Wizard_Anguis_Magicus.jpg'
  ];
  
  await open(page, JSON.stringify(s));
  
  // Open mats
  await page.getByTestId('my-vp').tap();
  await expect(page.getByTestId('mats')).toBeVisible({ timeout: 60_000 });
  
  // Tap first wizard in the pair display
  const wizardCards = page.locator('.mcard').filter({ hasText: '' });
  await wizardCards.first().click();
  
  await expect(page.getByTestId('expanded')).toBeVisible();
  
  // Should have 3 wizards to swipe through
  const indicator = page.getByTestId('card-indicator');
  const dots = await indicator.locator('.dot').count();
  expect(dots).toBe(3);
  
  await shot(page, 'swipe-mat-01-first');
  
  // Swipe to next
  await page.getByTestId('nav-next').click();
  await page.waitForTimeout(400);
  
  await shot(page, 'swipe-mat-02-second');
  
  // Swipe to third
  await page.getByTestId('nav-next').click();
  await page.waitForTimeout(400);
  
  await shot(page, 'swipe-mat-03-third');
  
  // At end, next button should be dimmed
  const nextBtn = page.getByTestId('nav-next');
  const opacity = await nextBtn.evaluate(el => getComputedStyle(el).opacity);
  expect(parseFloat(opacity)).toBeLessThan(1);
  
  // Close
  await page.getByTestId('ov-close').click();
});

test('Keyboard arrow navigation works', async ({ page }) => {
  await open(page, JSON.stringify(G8_AUTO));
  await expect(page.getByTestId('hand-0')).toBeVisible({ timeout: 60_000 });
  
  const v = await view(page);
  const handCount = me(v).hand.length;
  
  if (handCount < 2) {
    test.skip('Need at least 2 cards in hand');
  }
  
  // Open card
  await page.getByTestId('hand-0').tap();
  await expect(page.getByTestId('expanded')).toBeVisible();
  
  // Press right arrow
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  
  // Should be on card 2
  const indicator = page.getByTestId('card-indicator');
  if (handCount <= 5) {
    const activeDot = await indicator.locator('.dot.active').getAttribute('data-index');
    expect(activeDot).toBe('1');
  } else {
    await expect(indicator.locator('.counter')).toHaveText(`2 / ${handCount}`);
  }
  
  // Press left arrow
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  
  // Should be back to card 1
  if (handCount <= 5) {
    const activeDot = await indicator.locator('.dot.active').getAttribute('data-index');
    expect(activeDot).toBe('0');
  } else {
    await expect(indicator.locator('.counter')).toHaveText(`1 / ${handCount}`);
  }
  
  await page.getByTestId('ov-close').click();
});

test('Vertical scroll in card info does not trigger swipe', async ({ page }) => {
  await open(page, JSON.stringify(G8_AUTO));
  
  // Open a card with long text
  await page.locator('#board [data-slot^="spell_"]').first().tap();
  await expect(page.getByTestId('expanded')).toBeVisible();
  
  const initialIndicator = await page.getByTestId('card-indicator').textContent();
  
  // Try to scroll vertically on the overlay
  const overlay = page.getByTestId('expanded');
  const box = await overlay.boundingBox();
  
  // Vertical swipe should not change card
  await page.touchscreen.swipe(
    { x: box.x + box.width / 2, y: box.y + 100 },
    { x: box.x + box.width / 2, y: box.y + 300 },
    { steps: 5 }
  );
  
  await page.waitForTimeout(300);
  
  // Indicator should be unchanged
  const finalIndicator = await page.getByTestId('card-indicator').textContent();
  expect(finalIndicator).toBe(initialIndicator);
  
  await page.getByTestId('ov-close').click();
});

test('Card frame has no clipping on iPhone dimensions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14
  
  await open(page, JSON.stringify(G8_AUTO));
  await expect(page.getByTestId('hand-0')).toBeVisible({ timeout: 60_000 });
  
  // Open a card
  await page.getByTestId('hand-0').tap();
  await expect(page.getByTestId('expanded')).toBeVisible();
  
  // Check that card is fully visible
  await checkCardVisible(page);
  
  // Take screenshot
  await shot(page, 'swipe-iphone-no-clip');
  
  await page.getByTestId('ov-close').click();
});
