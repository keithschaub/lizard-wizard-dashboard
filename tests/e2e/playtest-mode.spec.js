import fs from 'fs';
import { test, expect } from './fixtures.js';

// Playtest mode: a long press on the version number in the menu opens the Playtest sheet. Pick Crystal Ball for spell
// slot 1 (through the shared enlarged view), set mana and gold, Start: the new game has them.
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-143.json', 'utf8');
test.use({ viewport: { width: 430, height: 775 } });

async function open(page) {
  await page.addInitScript((t) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('lw.save.v1', t); sessionStorage.setItem('seeded', '1');
  }, SAVE);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug);
  await page.evaluate(() => { window.lwDebug._g.aiStep = async () => false; });
  await page.waitForFunction(() => window.lwDebug.ready(), null, { timeout: 60_000 });
}

async function press(page, locator, ms) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
}

test('playtest: long-press the version, pick Crystal Ball, set mana and gold, start', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.getByTestId('btn-menu').tap();
  const version = page.getByTestId('menu-version');
  await expect(version).toBeVisible();
  // A normal tap does nothing new.
  await press(page, version, 80);
  await page.waitForTimeout(800);
  await expect(page.getByTestId('playtest')).toHaveCount(0);
  await expect(page.getByTestId('menu')).toBeVisible();
  await press(page, version, 900);
  const sheet = page.getByTestId('playtest');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('menu')).toHaveCount(0);
  for (const id of ['spells-0', 'spells-3', 'wizards-1', 'tower-0', 'hand-2', 'inventory-add']) await expect(page.getByTestId(`pt-${id}`)).toBeVisible();

  await page.getByTestId('pt-mana').fill('40');
  await page.getByTestId('pt-gold').fill('16');
  await page.getByTestId('pt-spells-0').tap();
  const picker = page.locator('[data-testid=playtest-picker]:not(.out)');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.pk-card')).toHaveCount(await page.evaluate(() => Object.values(window.lwDebug.cards()).filter((c) => c.deck === 'Spell').length));
  // The school filter narrows the grid to that school.
  await picker.getByTestId('pk-school-Alchemy').tap();
  const alchemy = await page.evaluate(() => Object.values(window.lwDebug.cards()).filter((c) => c.deck === 'Spell' && c.school === 'Alchemy').length);
  await expect(picker.locator('.pk-card')).toHaveCount(alchemy);
  // A tap enlarges the card in the shared view; Select marks it chosen.
  await picker.getByTestId('pk-card-Spell_Crystal_Ball').tap();
  const big = page.locator('[data-testid=expanded]:not(.out)');
  await expect(big).toBeVisible();
  await big.getByTestId('pk-select').tap();
  await expect(big).toHaveCount(0);
  await expect(picker.getByTestId('pk-card-Spell_Crystal_Ball')).toHaveClass(/\bon\b/);
  await expect(picker.getByTestId('pk-choice')).toContainText('Crystal Ball');
  await picker.getByTestId('pk-choose').tap();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('pt-spells-0')).toHaveAttribute('data-key', 'Spell_Crystal_Ball');
  await expect(page.getByTestId('pt-spells-1')).toContainText('Random');

  // Inventory: Add a spell, then Remove it and add it again; it starts on the mat, uncast.
  const addCharm = async () => {
    await page.getByTestId('pt-inventory-add').tap();
    await expect(picker).toBeVisible();
    await picker.getByTestId('pk-school-Enchantment').tap();
    await picker.getByTestId('pk-card-Spell_Charm').tap();
    await page.locator('[data-testid=expanded]:not(.out)').getByTestId('pk-select').tap();
    await picker.getByTestId('pk-choose').tap();
    await expect(page.getByTestId('pt-inventory-0')).toHaveAttribute('data-key', 'Spell_Charm');
  };
  await addCharm();
  await page.getByTestId('pt-inventory-0').tap();
  await expect(picker.getByTestId('pk-random')).toHaveText('Remove');
  await picker.getByTestId('pk-random').tap();
  await expect(page.getByTestId('pt-inventory-0')).toHaveCount(0);
  await addCharm();

  await page.getByTestId('pt-start').tap();
  await expect(sheet).toHaveCount(0, { timeout: 30_000 });
  const v = await page.evaluate(() => window.lwDebug.view());
  const me = v.players.find((p) => p.you);
  expect(v.round).toBe(1);
  expect(v.board.spell_face[0]).toBe('Spell_Crystal_Ball');
  expect([me.mana, me.gold]).toEqual([40, 16]);
  expect(me.spells).toEqual([{ key: 'Spell_Charm', cast: false }]);
  await expect(page.locator('#board [data-slot="spell_0"]').first()).toHaveAttribute('data-key', 'Spell_Crystal_Ball');
  await expect(page.getByTestId('my-mana')).toHaveText('40');
  await expect(page.getByTestId('my-gold')).toHaveText('16');
  // It saved like a normal game.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lw.save.v1')));
  expect(saved.meta.playtest.spells[0]).toBe('Spell_Crystal_Ball');
  expect(errors, errors.join('\n')).toEqual([]);
});
