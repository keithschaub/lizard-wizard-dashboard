import { test, expect } from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

test('Trap spell AI banner is a sentence, not raw JSON', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
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
