// Creation: pick face-up wizard or tower without crashing (UI keys vs engine paths).
import { test, expect } from './fixtures.js';
import { watchErrors, untilMyAction } from './helpers.js';

async function loadCreation(page, kind) {
  return page.evaluate(async (pickKind) => {
    const r = await fetch('engine/game/g8_state.json');
    const s = await r.json();
    const k = s.players.find((p) => p.name === 'Keith');
    k.tok = ['Horn', 'Horn', 'Horn', 'Horn', 'Eye_of_Newt'];
    k.mana = 30;
    const face = [...(s.spell_face || ['', '', ''])];
    face[0] = 'assets/Spell_Creation.jpg';
    s.spell_face = face;
    s.next = 'Keith';
    s.meta = s.meta || {};
    s.meta.web_pending = null;
    s.meta.pending = null;
    const wizKey = (s.wiz_face.find((x) => x) || '').split('/').pop().replace(/\.jpg$/, '');
    const towKey = (s.tower_face || '').split('/').pop().replace(/\.jpg$/, '');
    const wizCount0 = k.wizards.length;
    const towCount0 = (k.towers || []).length;
    const out = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!out.ok) throw new Error(out.error);
    window.lwDebug._g.setView(out.result);
    return { wizKey, towKey, wizCount0, towCount0, pickKind };
  }, kind);
}

test('Creation: take a face-up wizard', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  const prep = await loadCreation(page, 'wizards');
  await untilMyAction(page, async () => {});

  await page.getByTestId('slot-spell_0').tap();
  await page.getByTestId('research-cast').tap();
  await expect(page.getByTestId('effect')).toBeVisible();
  await page.getByTestId(`target-Available-${prep.wizKey}`).tap();

  await expect(page.getByTestId('effect')).toHaveCount(0, { timeout: 10_000 });
  const v = await page.evaluate(() => window.lwDebug.view());
  expect(v.pending).toBeFalsy();
  const me = v.players.find((p) => p.you);
  expect(me.wizards.length).toBe(prep.wizCount0 + 1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Creation: take the face-up tower', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  const prep = await loadCreation(page, 'towers');
  await untilMyAction(page, async () => {});

  await page.getByTestId('slot-spell_0').tap();
  await page.getByTestId('research-cast').tap();
  await expect(page.getByTestId('effect')).toBeVisible();
  await page.getByTestId(`target-Available-${prep.towKey}`).tap();

  await expect(page.getByTestId('effect')).toHaveCount(0, { timeout: 10_000 });
  const v = await page.evaluate(() => window.lwDebug.view());
  expect(v.pending).toBeFalsy();
  const me = v.players.find((p) => p.you);
  expect((me.towers || []).length).toBe(prep.towCount0 + 1);
  expect(errors, errors.join('\n')).toEqual([]);
});
