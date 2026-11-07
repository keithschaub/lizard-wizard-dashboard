import { test, expect } from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

test('a saved familiar research pending step reopens after reload', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  const fk = await page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const p = s.players.find((q) => q.name === 'Keith');
    p.mana = 50; p.gold = 0; p.wizards = []; p.familiars = []; p.spells = [];
    s.next = 'Keith'; s.meta.web_pending = null;
    const loaded = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!loaded.ok) throw new Error(loaded.error);
    window.lwDebug._g.setView(loaded.result);
    const familiar = loaded.result.board.fam_face.find(Boolean);
    const acted = await window.lwDebug._g.call('act_summon', { familiar, use: 'research' });
    if (!acted.ok) throw new Error(acted.error);
    const saved = await window.lwDebug._g.call('dump');
    if (!saved.ok) throw new Error(saved.error);
    localStorage.setItem('lw.save.v1', saved.result);
    return familiar;
  });

  await page.reload();
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  const research = page.getByTestId('new-research');
  await expect(research).toBeVisible();
  await expect(research.locator('[data-testid^="nr-"]')).toHaveCount(4);
  await research.locator('[data-testid^="nr-"]').first().tap();
  await expect.poll(async () => {
    const p = (await page.evaluate(() => window.lwDebug.view())).players.find((q) => q.you);
    return { owned: p.familiars.includes(fk), mana: p.mana };
  }).toEqual({ owned: true, mana: 45 });
});
