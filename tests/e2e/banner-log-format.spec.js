import { test, expect } from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function waitForBoard(page) {
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1' &&
    getComputedStyle(document.getElementById('loader')).opacity === '0', null, { timeout: 10_000 });
}

test('Trap spell AI banner is a sentence, not raw JSON', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  const text = await page.evaluate(async () => {
    const g = window.lwDebug._g;
    const dump = await g.call('dump');
    const s = JSON.parse(dump.result);
    s.meta.log.push({ r: 10, who: 'Newt', act: 'trap_spell' });
    const loaded = await g.call('load', { text: JSON.stringify(s) });
    g.setView(loaded.result);
    const log = await g.call('full_log');
    const entry = log.result.at(-1);
    window.ui.banner(g, entry, 0, 1);
    return entry.text;
  });
  expect(text).toContain('Newt cast Trap');
  expect(text).not.toContain('{');
  await expect(page.getByTestId('ai-banner-text')).toContainText('Newt cast Trap');
  await expect(page.getByTestId('ai-banner-text')).not.toContainText('{');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screenshots/banner-trap-dpr3.png', fullPage: true });
});

async function showGather(page, gather) {
  await page.evaluate(async (gather) => {
    const g = window.lwDebug._g;
    window.ui.banner(g, {
      r: 10, who: 'Newt', act: 'gather',
      text: `Newt gathered ${gather.reagents.join(', ')}`,
      gather,
    }, 0, 1);
  }, gather);
  await expect(page.getByTestId('ai-gather-structured')).toBeVisible();
}

test('structured short gather banner keeps reagent chips and tracks readable', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  await showGather(page, { reagents: ['Horn'], bonus: [], tracks: ['Horn'] });
  await expect(page.getByTestId('ai-gather-reagent')).toHaveCount(1);
  await expect(page.getByTestId('ai-gather-track')).toHaveCount(1);
  await expect(page.getByTestId('ai-gather-structured')).toContainText('Newt gathered');
  await expect(page.getByTestId('ai-gather-structured')).toContainText('Tracks up:');
  await page.getByTestId('ai-banner').screenshot({ path: 'docs/screenshots/banner-gather-short-dpr3.png' });
});

test('structured long gather banner wraps four reagents and tracks without clipping', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  await showGather(page, {
    reagents: ['Sulphur', 'Mandrake', 'Horn', 'Eye_of_Newt'],
    bonus: ['Sulphur'],
    tracks: ['Sulphur', 'Mandrake', 'Horn', 'Eye_of_Newt'],
  });
  await expect(page.getByTestId('ai-gather-reagent')).toHaveCount(4);
  await expect(page.getByTestId('ai-gather-bonus')).toContainText('bonus');
  await expect(page.getByTestId('ai-gather-track')).toHaveCount(4);
  const banner = page.getByTestId('ai-banner');
  await expect(banner).toBeVisible();
  const box = await banner.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.getByTestId('ai-banner').screenshot({ path: 'docs/screenshots/banner-gather-long-dpr3.png' });
});
