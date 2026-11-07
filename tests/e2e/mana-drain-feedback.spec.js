// Mana Drain: result toast after target pick (steal vs nothing to steal).
import { test, expect } from './fixtures.js';
import { watchErrors, untilMyAction } from './helpers.js';

async function loadManaDrain(page, { newtMana, lizMana }) {
  await page.evaluate(async ({ newtMana, lizMana }) => {
    const r = await fetch('engine/game/g8_state.json');
    const s = await r.json();
    const k = s.players.find((p) => p.name === 'Keith');
    k.tok = ['Horn', 'Horn', 'Horn', 'Nightshade', 'Foxglove', 'Foxglove', 'Mandrake', 'Mandrake', 'Mandrake', 'Mandrake'];
    k.mana = 30;
    const face = [...(s.spell_face || ['', '', '', ''])];
    face[0] = 'assets/Spell_Mana_Drain.jpg';
    s.spell_face = face;
    const nw = s.players.find((p) => p.name === 'Newt');
    const lz = s.players.find((p) => p.name === 'LizWiz');
    if (newtMana != null) nw.mana = newtMana;
    if (lizMana != null) lz.mana = lizMana;
    s.next = 'Keith';
    s.meta.web_pending = null;
    s.meta.pending = null;
    const out = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!out.ok) throw new Error(out.error);
    window.lwDebug._g.setView(out.result);
  }, { newtMana, lizMana });
}

async function castManaDrainOn(page, player) {
  await page.getByTestId('slot-spell_0').tap();
  await page.getByTestId('research-cast').tap();
  await expect(page.getByTestId('effect')).toBeVisible();
  await page.getByTestId(`target-${player}`).tap();
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveClass(/show/);
  return toast;
}

test('Mana Drain: toast shows stolen mana or nothing to steal', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  await loadManaDrain(page, { newtMana: 18, lizMana: 4 });
  await untilMyAction(page, async () => {});
  const toast1 = await castManaDrainOn(page, 'Newt');
  await expect(toast1).toContainText('Stole 15 mana from Newt');

  await loadManaDrain(page, { newtMana: 5, lizMana: 0 });
  await untilMyAction(page, async () => {});
  const toast2 = await castManaDrainOn(page, 'LizWiz');
  await expect(toast2).toContainText('LizWiz had no mana, nothing to steal');

  expect(errors, errors.join('\n')).toEqual([]);
});
