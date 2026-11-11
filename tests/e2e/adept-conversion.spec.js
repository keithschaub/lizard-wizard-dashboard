// Adept Conversion: convert sheet offers a second optional type; one action sells both.
import { test, expect } from './fixtures.js';
import { watchErrors, boot, view, me, untilMyAction, waitOverlayGone } from './helpers.js';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

test('Adept Conversion: dual-type convert from convert sheet', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });

  await page.evaluate(async () => {
    const r = await fetch('engine/game/g8_state.json');
    const s = await r.json();
    const k = s.players.find((p) => p.name === 'Keith');
    k.tok = ['Toadstool', 'Toadstool', 'Horn', 'Horn', 'Mandrake', 'Eye_of_Newt', 'Foxglove',
      ...Array(12).fill('Nightshade'), 'Sulphur'];
    k.spells = k.spells || [];
    k.spells.push({ img: 'Spell_Adept_Conversion.jpg', cast: true });
    s.tracks.Toadstool = 4;
    s.tracks.Horn = 3;
    s.tracks.Mandrake = 6;
    s.tracks.Eye_of_Newt = 5;
    s.tracks.Foxglove = 4;
    s.tracks.Nightshade = 7;
    s.tracks.Sulphur = 2;
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
  await expect(page.getByTestId('convert-adept-banner')).toHaveCount(0);
  await expect(page.locator('.adept-second-label')).toContainText('Also sell a second type');
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.getByTestId('convert-adept-type2-Mandrake')).toBeVisible();
  await expect(page.getByTestId('convert-adept-type2-Eye_of_Newt')).toBeVisible();
  await expect(page.getByTestId('convert-adept-type2-Foxglove')).toBeVisible();
  await expect(page.getByTestId('convert-adept-type2-Nightshade')).toBeVisible();
  await expect(page.getByTestId('convert-adept-type2-Sulphur')).toBeVisible();
  await expect(page.getByTestId('convert-held-count')).toHaveText('You have 2');
  await expect(page.getByTestId('convert-count-Nightshade')).toHaveText('×12');
  await expect(page.locator('[data-testid=convert-adept-type2] .reagent-choice-name')).toHaveCount(0);
  for (const [r, price] of Object.entries({ Mandrake: 6, Eye_of_Newt: 5, Foxglove: 4, Nightshade: 7, Sulphur: 2 })) {
    expect(v.legal.convert[r].value).toBe(price);
    await expect(page.getByTestId(`convert-adept-type2-${r}`).locator('.log-value-number')).toHaveText(String(price));
  }
  await expect(page.getByTestId('convert-gain2')).toHaveCount(1);
  await expect(page.getByTestId('convert-gain2')).toBeHidden();
  await expect(page.getByTestId('convert-result')).toContainText('You get');
  await expect(page.getByTestId('convert-result').locator('.convert-result-num')).toHaveText('8');
  await page.waitForTimeout(500);
  await page.getByTestId('convert').screenshot({ path: 'docs/screenshots/adept-counts-none-dpr3.png' });
  await page.getByTestId('convert').screenshot({ path: 'docs/screenshots/adept-counts-many-dpr3.png' });
  // Sheet defaults n to full holdings; sell 1 of each type for the assertion below.
  await page.getByTestId('convert-minus').tap();
  await page.getByTestId('convert-adept-type2-Horn').tap();
  await expect(page.getByTestId('convert-stepper2')).toBeVisible();
  await expect(page.getByTestId('convert-adept-type2-Horn')).toHaveClass(/on/);
  await page.getByTestId('convert').screenshot({ path: 'docs/screenshots/adept-counts-selected-dpr3.png' });
  await page.getByTestId('convert-adept-type2-Horn').tap();
  await expect(page.getByTestId('convert-stepper2')).toBeHidden();
  await page.getByTestId('convert-adept-type2-Horn').tap();
  await expect(page.getByTestId('convert-result').locator('.convert-result-num')).toHaveText('7');
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
