// Scribe free-cast must chain into the picked spell's effect (e.g. Time Shift deck picker).
import { test, expect } from './fixtures.js';
import { watchErrors, untilMyAction } from './helpers.js';

test('Scribe: picking Time Shift opens the Time Shift deck picker', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  await page.evaluate(async () => {
    const r = await fetch('engine/game/g8_state.json');
    const s = await r.json();
    const k = s.players.find((p) => p.name === 'Keith');
    k.tok = ['Eye_of_Newt', 'Eye_of_Newt', 'Mandrake', 'Horn'];
    k.mana = 30;
    const face = [...(s.spell_face || ['', '', '', ''])];
    face[0] = 'assets/Spell_Scribe.jpg';
    s.spell_face = face;
    const rest = s.spell_list.filter((p) => !String(p).includes('Time_Shift'));
    s.spell_list = [rest[0], 'assets/Spell_Time_Shift.jpg', ...rest.slice(1)];
    s.spell_deck = s.spell_list.length;
    s.next = 'Keith';
    s.meta = s.meta || {};
    s.meta.web_pending = null;
    s.meta.pending = null;
    const out = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!out.ok) throw new Error(out.error);
    window.lwDebug._g.setView(out.result);
  });

  await untilMyAction(page, async () => {});

  await page.getByTestId('slot-spell_0').tap();
  await page.getByTestId('research-cast').tap();
  await expect(page.getByTestId('effect')).toBeVisible();
  await page.getByTestId('scry-Spell_Time_Shift').tap();

  await expect(page.getByTestId('effect')).toBeVisible();
  await expect(page.getByTestId('deck-spells')).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});
