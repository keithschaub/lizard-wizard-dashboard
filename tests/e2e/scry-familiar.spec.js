import { test, expect } from './fixtures.js';
import { watchErrors } from './helpers.js';

test('Scry Familiar immediately opens the summon-use chooser', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  await page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const p = s.players.find((q) => q.name === 'Keith');
    p.gold = 0;
    p.mana = 20;
    p.tok = ['Foxglove', 'Foxglove', 'Horn'];
    p.wizards = [];
    p.towers = [];
    p.familiars = [];
    p.spells = [];
    s.spell_face = ['assets/Spell_Scry_Familiar.jpg', null, null, null];
    s.spell_list = [];
    s.spell_deck = 0;
    s.fam_list = [
      'assets/Familiar_10_Imp.jpg',
      'assets/Familiar_10_Corvum.jpg',
      'assets/Familiar_10_Vulpes.jpg',
      'assets/Familiar_10_Aranea.jpg',
      'assets/Familiar_10_Nympharum.jpg',
    ];
    s.fam_deck = s.fam_list.length;
    s.next = 'Keith';
    s.meta.humans = ['Keith'];
    s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    await window.lwDebug._g.act('act_research', { spell: 'Spell_Scry_Familiar', cast: true });
    window.lwDebug._g.afterAction();
  });

  await expect(page.getByTestId('effect')).toBeVisible();
  await expect(page.getByTestId('scry-Familiar_10_Imp')).toBeVisible();
  await page.getByTestId('scry-Familiar_10_Imp').tap();
  await expect(page.getByTestId('rise-use')).toBeVisible();
  await expect(page.getByTestId('rise-score')).toContainText('Score');
  await expect(page.getByTestId('rise-gather')).toBeVisible();
  await expect(page.getByTestId('rise-research')).toBeVisible();
  await expect(page.getByTestId('rise-dungeon')).toBeVisible();
  await page.getByTestId('rise-score').tap();
  await expect.poll(async () => Number((await page.getByTestId('my-gold').textContent()).trim())).toBeGreaterThan(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
