// Time Shift: after deck pick, show removed cards and a deck-count toast.
import { test, expect } from './fixtures.js';
import { watchErrors, boot, view, untilMyAction } from './helpers.js';

test('Time Shift: overlay shows removed cards, toast shows deck count', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  const spellDeckBefore = await page.evaluate(async () => {
    const r = await fetch('engine/game/g8_state.json');
    const s = await r.json();
    const k = s.players.find((p) => p.name === 'Keith');
    k.tok = ['Foxglove', 'Mandrake', 'Mandrake'];
    k.mana = 30;
    const face = [...(s.spell_face || ['', '', ''])];
    face[0] = 'assets/Spell_Time_Shift.jpg';
    s.spell_face = face;
    s.next = 'Keith';
    s.meta = s.meta || {};
    s.meta.web_pending = null;
    s.meta.pending = null;
    const top5 = s.spell_list.slice(0, 5).map((p) => {
      const base = String(p).split('/').pop();
      return base.endsWith('.jpg') ? base.slice(0, -4) : base;
    });
    const n = s.spell_list.length;
    const out = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!out.ok) throw new Error(out.error);
    window.lwDebug._g.setView(out.result);
    return { n, top5 };
  });

  await untilMyAction(page, async () => {});

  await page.getByTestId('slot-spell_0').tap();
  await page.getByTestId('research-cast').tap();
  await expect(page.getByTestId('effect')).toBeVisible();
  await page.getByTestId('deck-spells').tap();

  await expect(page.getByTestId('time-shift-title')).toBeVisible();
  const ov = page.locator('[data-testid=expanded]:not(.out)');
  await expect(ov).toBeVisible();
  const toast = page.locator('#toast.show');
  await expect(toast).toContainText(`Spells deck: ${spellDeckBefore.n - 6} cards left`);
  const card0 = ov.locator('[data-testid=expanded-card][data-index="0"]');
  await expect(card0.getByTestId('expanded-img')).toBeVisible();
  const img0 = await card0.getByTestId('expanded-img').getAttribute('src');
  expect(img0).toMatch(/Spell_/);

  if (spellDeckBefore.top5.length > 1) {
    await ov.getByTestId('nav-next').tap();
    await page.waitForTimeout(350);
    const img1 = await ov.locator('[data-testid=expanded-card][data-index="1"]').getByTestId('expanded-img').getAttribute('src');
    expect(img1).not.toBe(img0);
  }

  await page.getByTestId('time-shift-done').tap();
  await expect(page.locator('[data-testid=expanded]:not(.out)')).toHaveCount(0);

  const v = await view(page);
  expect(v.board.spell_deck).toBe(spellDeckBefore.n - 6);
  expect(errors, errors.join('\n')).toEqual([]);
});
