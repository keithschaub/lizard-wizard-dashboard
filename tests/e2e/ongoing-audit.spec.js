// Powerful Helper: summon-score sub-label shows helper bonus when cast.
import { test, expect } from './fixtures.js';
import { watchErrors, untilMyAction } from './helpers.js';

test('Powerful Helper: summon score sub-label shows helper bonus', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  const famKey = await page.evaluate(async () => {
    const r = await fetch('engine/game/g8_state.json');
    const s = await r.json();
    const k = s.players.find((p) => p.name === 'Keith');
    k.mana = 50;
    k.spells = [{ img: 'assets/Spell_Powerful_Helper.jpg', cast: true }];
    s.next = 'Keith';
    s.meta = s.meta || {};
    s.meta.web_pending = null;
    const fk = (s.fam_face.find((x) => x) || '').split('/').pop().replace(/\.jpg$/, '');
    const out = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!out.ok) throw new Error(out.error);
    window.lwDebug._g.setView(out.result);
    return fk;
  });

  await untilMyAction(page, async () => {});
  const v = await page.evaluate(() => window.lwDebug.view());
  const idx = v.board.fam_face.indexOf(famKey);
  await page.getByTestId(`slot-fam_${idx}`).tap();
  await expect(page.getByTestId('summon-score')).toBeVisible();
  const sub = await page.getByTestId('summon-score').textContent();
  expect(sub).toMatch(/Powerful Helper/);
  expect(errors, errors.join('\n')).toEqual([]);
});
