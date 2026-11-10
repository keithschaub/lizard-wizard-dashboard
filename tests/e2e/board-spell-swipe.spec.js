// Board spell row: researchFlow expand must swipe across spell_face and refresh actions.
import { test, expect } from './fixtures.js';
import { watchErrors, boot, view } from './helpers.js';

test('board spell research: swipe changes card and research button targets the new spell', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  const v = await view(page);
  const spells = (v.board.spell_face || []).filter(Boolean);
  const legal = v.legal?.research || {};
  expect(spells.length).toBeGreaterThanOrEqual(2);

  const startIdx = spells.findIndex((k) => legal[k]);
  expect(startIdx, 'at least one face-up spell is researchable').toBeGreaterThanOrEqual(0);

  await page.getByTestId(`slot-spell_${startIdx}`).tap();
  const ov = page.getByTestId('expanded');
  await expect(ov).toBeVisible();
  await expect(page.getByTestId('card-indicator').locator('.dot')).toHaveCount(spells.length);
  await expect(page.getByTestId('nav-next')).toBeVisible();
  await expect(ov.locator('.cardinfo-container .log-school-chip')).toBeVisible();
  await expect(ov.locator('.cardinfo-container .log-value-chip')).toBeVisible();

  const spellAt = async () => {
    const idx = Number(await ov.locator('[data-testid=card-indicator] .dot.active').getAttribute('data-index'));
    return { idx, key: spells[idx], img: ov.locator(`[data-testid=expanded-card][data-index="${idx}"]`).getByTestId('expanded-img') };
  };

  const t0 = await spellAt();
  const img0 = await t0.img.getAttribute('src');
  const mana0 = legal[t0.key]?.mana;
  await expect(page.getByTestId('research-only').locator('.log-value-number')).toHaveText(String(mana0));

  await page.getByTestId('nav-next').tap();
  await page.waitForTimeout(350);

  const t1 = await spellAt();
  expect(t1.idx).toBe((t0.idx + 1) % spells.length);
  const img1 = await t1.img.getAttribute('src');
  expect(img1).not.toBe(img0);

  const L1 = legal[t1.key];
  if (L1) {
    await expect(page.getByTestId('research-only').locator('.log-value-number')).toHaveText(String(L1.mana));
    await expect(page.getByTestId('research-cast')).toBeVisible();
  } else {
    await expect(page.getByTestId('research-only')).toHaveCount(0);
  }

  expect(errors, errors.join('\n')).toEqual([]);
});
