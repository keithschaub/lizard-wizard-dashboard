import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot, watchErrors } from './helpers.js';

// Issue #144: tapping a draw deck enlarges it with a readable count. fixtures/issue-144.json is Keith's round 48
// save (a finished game): spell deck 31, dungeon 16, familiars 1, towers 0, wizards 0.
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-144.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

async function open(page, save) {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), save);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug);
  await page.evaluate(() => { window.lwDebug._g.aiStep = async () => false; });
  await page.waitForFunction(() => window.lwDebug.ready(), null, { timeout: 60_000 });
}

test('each draw deck opens enlarged with its count: plural, singular and empty', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, SAVE);
  await page.getByTestId('go-close').tap();
  await expect(page.getByTestId('game-over')).toHaveCount(0);
  const want = { spell_deck: [31, 'cards'], dungeon_deck: [16, 'cards'], fam_deck: [1, 'card'], tower_deck: [0, 'cards'], wiz_deck: [0, 'cards'] };
  for (const [slot, [n, label]] of Object.entries(want)) {
    await expect(page.getByTestId(`slot-${slot}`)).toContainText(`${n} cards`);
    await page.getByTestId(`slot-${slot}`).tap();
    const view = page.getByTestId('deck-view');
    await expect(view).toBeVisible();
    await expect(page.getByTestId('deck-view-n')).toHaveText(String(n));
    await expect(page.getByTestId('deck-view-count')).toHaveText(`${n}${label}`);
    const stack = page.getByTestId('deck-view-stack');
    await expect(stack).toHaveClass(n ? /dv-stack(?!.*empty)/ : /empty/);
    await expect(stack.locator('.dv-edge')).toHaveCount(Math.min(6, Math.ceil(n / 6)));
    await expect(stack.locator('.dv-empty')).toHaveCount(n ? 0 : 1);
    await expect(page.getByTestId('mats')).toHaveCount(0);
    if (slot === 'fam_deck') await page.mouse.click(215, 740);             // tap outside the deck
    else await page.getByTestId('deck-view-close').tap();
    await expect(view).toHaveCount(0);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('with Divination cast and treasure left, the dungeon deck still opens Divination', async ({ page }) => {
  const s = JSON.parse(fs.readFileSync('engine/game/g8_state.json', 'utf8'));
  s.players.find((p) => p.name === 'Keith').spells = [{ img: 'assets/Spell_Divination.jpg', cast: true }];
  await open(page, JSON.stringify(s));
  expect(await page.evaluate(() => window.lwDebug.view().legal.divination)).toBe(true);
  await page.getByTestId('slot-dungeon_deck').tap();
  await expect(page.getByTestId('divination-enter')).toBeVisible();
  await expect(page.getByTestId('deck-view')).toHaveCount(0);
});
