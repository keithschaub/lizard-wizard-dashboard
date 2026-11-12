// Transform (2:1) on convert sheet, then sell in the same action.
import { test, expect } from './fixtures.js';
import { watchErrors, untilMyAction, view, waitOverlayGone } from './helpers.js';

test('Transform: 2 tokens become target type then convert in one action', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  await page.evaluate(async () => {
    const r = await fetch('engine/game/g8_state.json');
    const s = await r.json();
    const k = s.players.find((p) => p.name === 'Keith');
    k.tok = ['Toadstool', 'Horn', 'Horn', 'Sulphur', 'Foxglove', 'Foxglove', 'Mandrake', 'Mandrake', 'Mandrake', 'Mandrake'];
    k.spells = [{ img: 'assets/Spell_Transform.jpg', cast: true }];
    s.tracks.Toadstool = 4;
    s.next = 'Keith';
    s.meta.web_pending = null;
    const out = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!out.ok) throw new Error(out.error);
    window.lwDebug._g.setView(out.result);
  });

  await untilMyAction(page, async () => {});
  const manaBefore = (await view(page)).players.find((p) => p.you).mana;

  await page.getByTestId('token-Toadstool').tap();
  await expect(page.getByTestId('convert-transform')).toBeVisible();
  await page.getByTestId('transform-toggle').tap();
  await page.getByTestId('transform-pick-1').tap();
  await page.getByTestId('transform-pick-3').tap();
  await page.getByTestId('transform-target-Toadstool').tap();
  await page.getByTestId('transform-add').tap();
  await expect(page.getByTestId('transform-done-0').locator('.transform-line')).toHaveAttribute('aria-label', 'Horn + Sulphur → Toadstool');
  await page.getByTestId('convert-go').tap();
  await waitOverlayGone(page, 'convert');
  await page.waitForFunction((m) => window.lwDebug.view().players.find((p) => p.you).mana > m, manaBefore);

  const v = await view(page);
  const me = v.players.find((p) => p.you);
  expect(me.mana).toBe(manaBefore + 8);   // the Toadstool Transform made joins the sale: 2 x 4 mana
  expect(me.tok.filter((x) => x === 'Toadstool')).toHaveLength(0);
  expect(me.tok.filter((x) => x === 'Horn')).toHaveLength(1);
  expect(me.tok.filter((x) => x === 'Sulphur')).toHaveLength(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
