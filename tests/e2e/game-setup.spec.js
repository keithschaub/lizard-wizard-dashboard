// New-game setup wizard (webkit-iphone): three setup screens then reagent deal.
import { test, expect } from './fixtures.js';
import { shot } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('setup wizard: name, table size, AI seats, then reagent deal', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'iPhone layout project only');
  await page.addInitScript(() => localStorage.setItem('lw.setup.v1', JSON.stringify({
    human_name: 'Keith', player_count: 3,
    ais: [{ name: 'Newt', level: 'normal' }, { name: 'LizWiz', level: 'normal' }],
  })));
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 90_000 });
  await page.getByTestId('btn-menu').tap();
  await page.getByTestId('menu-new-game').tap();
  await expect(page.getByTestId('game-setup')).toBeVisible();
  await expect(page.getByTestId('setup-custom-game')).toHaveText(/Custom gameChoose players, AI names & difficulty/);
  await expect(page.getByTestId('setup-quick-start')).toBeVisible();
  await shot(page, 'game-setup-01-name');
  await shot(page, 'setup-name-custom-game-dpr3');
  await page.getByTestId('setup-name-input').fill('Rex');
  await page.getByTestId('setup-custom-game').tap();
  await expect(page.getByTestId('setup-size-3')).toBeVisible();
  await shot(page, 'game-setup-02-table');
  await page.getByTestId('setup-size-2').tap();
  await page.getByTestId('setup-continue').tap();
  await expect(page.getByTestId('setup-ai-card-0')).toBeVisible();
  await shot(page, 'game-setup-03-ais');
  await page.getByTestId('setup-ai-0-hard').tap();
  await page.getByTestId('setup-start').tap();
  await expect(page.getByTestId('new-game-hand')).toBeVisible({ timeout: 60_000 });
  const raw = await page.evaluate(() => localStorage.getItem('lw.setup.v1'));
  const cfg = JSON.parse(raw);
  expect(cfg.human_name).toBe('Rex');
  expect(cfg.player_count).toBe(2);
  expect(cfg.ais[0].level).toBe('hard');
});

test('setup name step keeps Custom game styled when no setup is saved', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'iPhone layout project only');
  await page.addInitScript(() => localStorage.removeItem('lw.setup.v1'));
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 90_000 });
  await page.getByTestId('btn-menu').tap();
  await page.getByTestId('menu-new-game').tap();
  await expect(page.getByTestId('game-setup')).toBeVisible();
  await expect(page.getByTestId('setup-quick-start')).toHaveCount(0);
  await expect(page.getByTestId('setup-custom-game')).toHaveText(/Custom gameChoose players, AI names & difficulty/);
  await shot(page, 'setup-name-custom-game-nosave-dpr3');
});
