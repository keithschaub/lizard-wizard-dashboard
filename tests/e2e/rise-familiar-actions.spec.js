import { test, expect } from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

test('Rise opens familiar actions and Score changes state', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug?.ready(), null, { timeout: 60_000 });
  await page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const p = s.players.find((q) => q.name === 'Keith');
    p.mana = 50; p.gold = 0; p.tok = ['Mandrake', 'Nightshade', 'Nightshade', 'Horn'];
    p.familiars = ['assets/Familiar_5_Imp.jpg']; p.spells = [];
    s.spell_face = ['assets/Spell_Rise.jpg', null, null, null];
    s.spell_list = []; s.spell_deck = 0; s.next = 'Keith'; s.meta.web_pending = null;
    const loaded = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!loaded.ok) throw new Error(loaded.error);
    window.lwDebug._g.setView(loaded.result);
    const acted = await window.lwDebug._g.act('act_research', { spell: 'Spell_Rise', cast: true });
    if (!acted) throw new Error(document.querySelector('[data-testid=toast]')?.textContent || 'Rise cast failed');
    window.lwDebug._g.afterAction();
  });

  await expect(page.getByTestId('effect')).toBeVisible();
  await page.getByTestId('rise-Familiar_5_Imp').tap();
  await expect(page.getByTestId('rise-use')).toBeVisible();
  const gold = Number((await page.getByTestId('my-gold').textContent()).trim());
  await page.getByTestId('rise-score').tap();
  await expect.poll(async () => Number((await page.getByTestId('my-gold').textContent()).trim())).toBeGreaterThan(gold);
});
