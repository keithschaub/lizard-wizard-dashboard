import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

async function seedSummon(page) {
  await boot(page);
  return page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const me = s.players.find((p) => p.name === 'Keith');
    me.mana = 50;
    me.gold = 3;
    me.familiars = [];
    s.next = 'Keith';
    s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    window.lwDebug._g.aiStep = async () => false;
    return r.result;
  });
}

test('Summon familiar: school pulse class then action tiles (#summon-pulse)', async ({ page }) => {
  const v = await seedSummon(page);
  const cards = await page.evaluate(() => window.lwDebug.cards());
  const fk = v.board.fam_face.find((k) => k && cards[k]?.school === 'Sorcery') || v.board.fam_face.find(Boolean);
  const slot = v.board.fam_face.indexOf(fk);
  const cardSchool = cards[fk]?.school;

  await page.getByTestId(`slot-fam_${slot}`).click();
  const chooser = page.getByTestId('summon-use');
  await expect(chooser).toBeVisible();

  const pulse = await page.evaluate(() => ({
    active: document.querySelector('[data-testid="summon-use"]')?.dataset.summonPulse,
    pending: !!document.querySelector('.summon-pulse-pending'),
    slug: document.querySelector('.big-frame.summon-pulse')?.className || '',
  }));
  expect(pulse.active).toBe('active');
  expect(pulse.pending).toBe(true);

  await page.evaluate(() => {
    const frame = document.querySelector('.big-frame.summon-pulse');
    if (frame) {
      frame.style.animationDuration = '8s';
      frame.style.animationDelay = '-0.32s';
    }
  });
  await page.screenshot({ path: 'docs/screenshots/summon-pulse-430x775.png', fullPage: true });

  await expect.poll(async () => {
    const st = await page.evaluate(() => ({
      pending: document.querySelectorAll('.summon-pulse-pending').length,
      pulse: document.querySelectorAll('.big-frame.summon-pulse').length,
      active: document.querySelector('[data-testid="summon-use"]')?.dataset.summonPulse || '',
    }));
    return st.pending === 0 && st.pulse === 0 && st.active === '';
  }, { timeout: 4000 }).toBe(true);
  await expect(page.getByTestId('summon-score')).toBeVisible();
  expect(pulse.slug).toContain(`summon-pulse-${String(cardSchool || '').toLowerCase()}`);
});

test('Score familiar: school blink and +N gold float (#score-feedback)', async ({ page }) => {
  const v = await seedSummon(page);
  const fk = v.board.fam_face.find(Boolean);
  const slot = v.board.fam_face.indexOf(fk);
  const leg = v.legal.summon[fk];
  const expectedGold = (leg?.score_gold || 0) + (leg?.powerful_helper || 0);
  const school = await page.evaluate((k) => window.lwDebug.cards()[k]?.school, fk);

  await page.getByTestId(`slot-fam_${slot}`).click();
  await expect.poll(async () => (await page.locator('.summon-pulse-pending').count()) === 0, { timeout: 4000 }).toBe(true);
  await page.getByTestId('summon-score').click();

  await expect(page.getByTestId('score-gold-float')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('score-gold-float')).toHaveAttribute('data-gold-delta', String(expectedGold));

  await page.getByTestId('eye-toggle').click();
  await expect(page.getByTestId('inventory')).toBeVisible();

  const blinked = await page.evaluate(({ sc, gold }) => {
    window.lwDebug.runScoreFamiliarFeedback(sc, gold);
    return {
      blink: document.querySelectorAll('.mcard.score-school-blink').length,
      hand: document.querySelectorAll('.mat-hand .mcard.score-school-blink').length,
      schoolCards: document.querySelectorAll(`#peek-layer .mat.you .mcard[data-card-school="${sc}"]`).length,
    };
  }, { sc: school, gold: expectedGold });
  expect(blinked.hand).toBe(0);
  expect(blinked.schoolCards).toBeGreaterThan(0);
  expect(blinked.blink).toBeGreaterThan(0);

  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="score-gold-float"]');
    if (el) { el.style.animationDuration = '8s'; el.style.animationDelay = '-0.4s'; }
    document.querySelectorAll('.mcard.score-school-blink').forEach((n) => {
      n.style.animationDuration = '8s';
      n.style.animationDelay = '-0.2s';
    });
  });
  await page.screenshot({ path: 'docs/screenshots/score-feedback-430x775.png', fullPage: true });

  await expect.poll(async () => {
    const left = await page.evaluate(() => ({
      float: document.querySelectorAll('[data-testid="score-gold-float"]').length,
      blink: document.querySelectorAll('.mcard.score-school-blink').length,
    }));
    return left.float === 0 && left.blink === 0;
  }, { timeout: 3000 }).toBe(true);
});