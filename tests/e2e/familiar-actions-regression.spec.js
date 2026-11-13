import { test, expect } from './fixtures.js';
import { boot, view, watchErrors } from './helpers.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function seed(page) {
  await boot(page);
  return page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const p = s.players.find((q) => q.name === 'Keith');
    p.mana = 50; p.gold = 0; p.wizards = []; p.familiars = []; p.spells = [];
    s.next = 'Keith'; s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    return r.result.board.fam_face.find(Boolean);
  });
}

async function openSummon(page, fk) {
  const v = await view(page);
  await page.getByTestId(`slot-fam_${v.board.fam_face.indexOf(fk)}`).tap();
  await expect(page.getByTestId('summon-use')).toBeVisible();
  return v.players.find((p) => p.you);
}

async function owned(page, fk, before) {
  await expect.poll(async () => {
    const p = (await view(page)).players.find((q) => q.you);
    return { owned: p.familiars.includes(fk), mana: p.mana };
  }).toEqual({ owned: true, mana: before.mana - 5 });
}

test('summon Score commits the familiar and adds gold', async ({ page }) => {
  const errors = watchErrors(page);
  const fk = await seed(page);
  const before = await openSummon(page, fk);
  const gold = before.gold;
  await page.getByTestId('summon-score').tap();
  await owned(page, fk, before);
  await expect.poll(async () => Number((await page.getByTestId('my-gold').textContent()).trim())).toBeGreaterThan(gold);
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('summon Gather commits the familiar and completes its gather path', async ({ page }) => {
  const errors = watchErrors(page);
  const fk = await seed(page);
  const before = await openSummon(page, fk);
  await page.getByTestId('summon-gather').tap();
  await owned(page, fk, before);
  await expect(page.getByTestId('summon-use')).toHaveCount(0);
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('summon Dungeon commits the familiar and opens the dungeon draw', async ({ page }) => {
  const errors = watchErrors(page);
  const fk = await seed(page);
  const before = await openSummon(page, fk);
  await page.getByTestId('summon-dungeon').tap();
  await expect(page.getByTestId('dungeon')).toBeVisible();
  await page.getByTestId('dungeon-deck').tap();
  await expect(page.getByTestId('dungeon-drawn')).toBeVisible();
  await expect(page.getByTestId('dungeon-stop')).toBeVisible();
  await page.getByTestId('dungeon-stop').tap();
  await expect(page.getByTestId('dungeon')).toHaveCount(0);
  await owned(page, fk, before);
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

test('summon Research commits the familiar, opens four spells, and can finish', async ({ page }) => {
  const errors = watchErrors(page);
  const fk = await seed(page);
  const before = await openSummon(page, fk);
  await page.getByTestId('summon-research').click();
  const research = page.getByTestId('new-research');
  await expect(research).toBeVisible();
  await expect(research.locator('[data-testid=card-indicator] .dot')).toHaveCount(4);
  await research.screenshot({ path: 'docs/screenshots/familiar-new-research-dpr3.png' });
  await research.getByTestId('nr-take').tap();
  await expect(research).toHaveCount(0);
  await expect.poll(async () => {
    const p = (await view(page)).players.find((q) => q.you);
    return { owned: p.familiars.includes(fk), spells: p.spells.length };
  }).toEqual({ owned: true, spells: 1 });
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});
