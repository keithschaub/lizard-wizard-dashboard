// Adept Conversion: convert sheet offers a second optional type; one action sells both.
import { test, expect } from './fixtures.js';
import { watchErrors, boot, view, me, untilMyAction, waitOverlayGone } from './helpers.js';

test('Adept Conversion: dual-type convert from convert sheet', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  await page.evaluate(async () => {
    const r = await fetch('engine/game/g8_state.json');
    const s = await r.json();
    const k = s.players.find((p) => p.name === 'Keith');
    k.tok = ['Toadstool', 'Toadstool', 'Horn', 'Horn'];
    k.spells = k.spells || [];
    k.spells.push({ img: 'Spell_Adept_Conversion.jpg', cast: true });
    s.tracks.Toadstool = 4;
    s.tracks.Horn = 3;
    s.next = 'Keith';
    s.meta = s.meta || {};
    s.meta.web_pending = null;
    s.meta.pending = null;
    const out = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!out.ok) throw new Error(out.error);
    window.lwDebug._g.setView(out.result);
  });
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  let v = await untilMyAction(page, async () => {});
  const mana0 = me(v).mana;
  expect(v.legal.adept_conversion).toBe(true);

  await page.getByTestId('token-Toadstool').tap();
  await expect(page.getByTestId('convert-adept-note')).toBeVisible();
  // Sheet defaults n to full holdings; sell 1 of each type for the assertion below.
  await page.getByTestId('convert-minus').tap();
  await page.getByTestId('convert-adept-type2').selectOption({ label: 'Horn' });
  await expect(page.getByTestId('convert-stepper2')).toBeVisible();
  await page.getByTestId('convert-go').tap();
  await waitOverlayGone(page, 'convert');

  v = await view(page);
  expect(me(v).tok.filter((x) => x === 'Toadstool')).toHaveLength(1);
  expect(me(v).tok.filter((x) => x === 'Horn')).toHaveLength(1);
  expect(v.board.tracks.Toadstool).toBe(3);
  expect(v.board.tracks.Horn).toBe(2);
  expect(me(v).mana).toBe(mana0 + 4 + 3);
  expect(errors, errors.join('\n')).toEqual([]);
});
