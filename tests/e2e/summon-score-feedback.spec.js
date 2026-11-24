import fs from 'fs';
import path from 'path';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';
import {
  freezeSummonPulsePeakWhenReady,
  freezeScoreBlinkPeakWhenReady,
  screenshotZoomFromRect,
} from './summon-pulse-freeze.js';

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

const ARTIFACTS = '/opt/cursor/artifacts';
const LEGACY_DEFAULT_BLUE = '120, 170, 255';
const PINK_ENCHANTMENT = /255,\s*143,\s*216|rgb\(255,\s*143,\s*216\)|#ff8fd8/i;
const WHITE_GLOW = /245,\s*245,\s*255|255,\s*255,\s*255/i;
const NECRO_EDGE = /200,\s*200,\s*210/;
const NECRO_OLD_BLUE = /143,\s*188,\s*255|rgb\(143,\s*188,\s*255\)/;

async function seedFamPair(page) {
  await boot(page);
  return page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    s.round = 1;
    s.next = 'Keith';
    s.meta.web_pending = null;
    const me = s.players.find((p) => p.name === 'Keith');
    me.mana = 50;
    s.fam_face = ['assets/Familiar_5_Troglodytam.jpg', 'assets/Familiar_5_Nympharum.jpg'];
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    window.lwDebug._g.aiStep = async () => false;
    return r.result;
  });
}

async function seedSummon(page, next = 'Keith') {
  await boot(page);
  return page.evaluate(async (nextSeat) => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const me = s.players.find((p) => p.name === 'Keith');
    me.mana = 50;
    me.gold = 3;
    me.familiars = [];
    s.next = nextSeat;
    s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    window.lwDebug._g.aiStep = async () => false;
    return r.result;
  }, next);
}

async function waitSummonOverlayReady(page) {
  await expect.poll(async () => page.evaluate(() => {
    const ov = document.querySelector('[data-testid="summon-use"]');
    if (!ov || ov.classList.contains('out')) return false;
    return parseFloat(getComputedStyle(ov).opacity) >= 0.99;
  }), { timeout: 3000 }).toBe(true);
}

async function assertNoNeighborInTrack(page) {
  const peek = await page.evaluate(() => {
    const track = document.querySelector('.card-track');
    const pulse = document.querySelector('.big-frame.summon-pulse');
    if (!track || !pulse) return { ok: false, reason: 'missing pulse or track' };
    const trackRect = track.getBoundingClientRect();
    const current = pulse.dataset.index;
    const breaches = [];
    for (const f of track.querySelectorAll('.big-frame')) {
      if (f.dataset.index === current) continue;
      const r = f.getBoundingClientRect();
      const ix = Math.min(r.right, trackRect.right) - Math.max(r.left, trackRect.left);
      const iy = Math.min(r.bottom, trackRect.bottom) - Math.max(r.top, trackRect.top);
      if (ix > 1 && iy > 1) breaches.push({ index: f.dataset.index, ix, iy, vis: getComputedStyle(f).visibility });
    }
    return { ok: breaches.length === 0, breaches };
  });
  expect(peek.ok, JSON.stringify(peek)).toBe(true);
}

async function captureLivePulsePeak(page, { index, rgbRe, shotPath, peakPromise = null }) {
  const peak = peakPromise
    ? await peakPromise
    : await freezeSummonPulsePeakWhenReady(page, index, { timeoutMs: 12000 });
  await waitSummonOverlayReady(page);
  expect(peak.ok, JSON.stringify(peak)).toBe(true);
  expect(peak.boxShadow, peak.boxShadow).not.toBe('none');
  expect(peak.boxShadow).toMatch(rgbRe);
  const ring = await page.evaluate((idx) => {
    const frame = document.querySelector(`.big-frame.summon-pulse[data-index="${idx}"]`);
    const img = frame?.querySelector('img.big');
    const rect = img?.getBoundingClientRect();
    return {
      slug: frame?.className,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
    };
  }, index);
  expect(ring.width, 'frame not laid out').toBeGreaterThan(40);
  expect(ring.height).toBeGreaterThan(40);
  await assertNoNeighborInTrack(page);
  if (shotPath) await page.screenshot({ path: shotPath, fullPage: true });
  return { ...peak, ...ring };
}

test('Enchantment familiar summon glow is white, not pink (#172)', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await boot(page);
  await page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const me = s.players.find((p) => p.name === 'Keith');
    me.mana = 50;
    me.gold = 3;
    me.familiars = ['assets/Familiar_5_Aranea.jpg'];
    s.next = 'Keith';
    s.fam_face = ['assets/Familiar_5_Aranea.jpg', 'assets/Familiar_5_Nympharum.jpg'];
    s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    window.lwDebug._g.aiStep = async () => false;
  });

  const peakPromise = freezeSummonPulsePeakWhenReady(page, 0, { schoolSlug: 'enchantment', timeoutMs: 12000 });
  await page.getByTestId('slot-fam_0').click();
  await expect(page.getByTestId('summon-use')).toBeVisible();
  const peak = await peakPromise;
  expect(peak.ok, JSON.stringify(peak)).toBe(true);
  expect(peak.index).toBe('0');
  expect(peak.slug).toContain('summon-pulse-enchantment');
  expect(peak.pulseVar).toMatch(WHITE_GLOW);
  expect(peak.pulseVar).not.toMatch(PINK_ENCHANTMENT);
  expect(peak.boxShadow, peak.boxShadow).not.toBe('none');
  expect(peak.boxShadow).toMatch(WHITE_GLOW);
  expect(peak.boxShadow).not.toMatch(PINK_ENCHANTMENT);

  await page.screenshot({
    path: path.join(ARTIFACTS, 'summon-pulse-enchantment-aranea-430x775.png'),
    scale: 'device',
    clip: {
      x: Math.max(0, peak.rect.x - 40),
      y: Math.max(0, peak.rect.y - 40),
      width: peak.rect.width + 80,
      height: peak.rect.height + 80,
    },
  });
  await screenshotZoomFromRect(page, peak.rect, path.join(ARTIFACTS, 'summon-pulse-enchantment-zoom.png'));

  await page.getByTestId('summon-cancel').click();
  await expect(page.getByTestId('summon-use')).toHaveCount(0);

  await page.getByTestId('eye-toggle').click();
  await expect(page.getByTestId('inventory')).toBeVisible();
  await page.evaluate(() => {
    window.lwDebug.runScoreFamiliarFeedback('Enchantment', 4);
  });
  await page.waitForTimeout(50);
  const blinkSel = '#peek-layer .mat.you .mcard.score-school-blink.score-school-enchantment[data-card-school="Enchantment"]';
  const blink = await freezeScoreBlinkPeakWhenReady(page, blinkSel);
  expect(blink.ok, JSON.stringify(blink)).toBe(true);
  expect(blink.blinkVar).toMatch(WHITE_GLOW);
  expect(blink.blinkVar).not.toMatch(PINK_ENCHANTMENT);
  expect(blink.boxShadow, blink.boxShadow).not.toBe('none');
  expect(blink.boxShadow).toMatch(WHITE_GLOW);

  await page.screenshot({
    path: path.join(ARTIFACTS, 'score-school-blink-enchantment-430x775.png'),
    scale: 'device',
    clip: {
      x: Math.max(0, blink.rect.x - 48),
      y: Math.max(0, blink.rect.y - 48),
      width: blink.rect.width + 96,
      height: blink.rect.height + 96,
    },
  });
  await screenshotZoomFromRect(page, blink.rect, path.join(ARTIFACTS, 'score-school-blink-enchantment-zoom.png'));
});

test('Necromancy familiar summon glow: pale edge and smoky outer ring', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await boot(page);
  await page.evaluate(async () => {
    const s = await (await fetch('engine/game/g8_state.json')).json();
    const me = s.players.find((p) => p.name === 'Keith');
    me.mana = 50;
    me.gold = 3;
    s.next = 'Keith';
    s.fam_face = ['assets/Familiar_5_Corvum.jpg', 'assets/Familiar_5_Nympharum.jpg'];
    s.meta.web_pending = null;
    const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
    if (!r.ok) throw new Error(r.error);
    window.lwDebug._g.setView(r.result);
    window.lwDebug._g.aiStep = async () => false;
  });

  const peakPromise = freezeSummonPulsePeakWhenReady(page, 0, {
    schoolSlug: 'necromancy',
    timeoutMs: 12000,
    atMs: 290,
  });
  await page.getByTestId('slot-fam_0').click();
  await expect(page.getByTestId('summon-use')).toBeVisible();
  await waitSummonOverlayReady(page);
  const peak = await peakPromise;
  expect(peak.ok, JSON.stringify(peak)).toBe(true);
  expect(peak.slug).toContain('summon-pulse-necromancy');
  expect(peak.pulseEdge).toMatch(/200,\s*200,\s*210|rgb\(200,\s*200,\s*210\)/);
  expect(peak.boxShadow, peak.boxShadow).not.toBe('none');
  expect(peak.boxShadow).toMatch(NECRO_EDGE);
  expect(peak.boxShadow).not.toMatch(NECRO_OLD_BLUE);

  await page.screenshot({
    path: path.join(ARTIFACTS, 'summon-pulse-necromancy-corvum-430x775.png'),
    scale: 'device',
    clip: {
      x: Math.max(0, peak.rect.x - 40),
      y: Math.max(0, peak.rect.y - 40),
      width: peak.rect.width + 80,
      height: peak.rect.height + 80,
    },
  });
  await screenshotZoomFromRect(page, peak.rect, path.join(ARTIFACTS, 'summon-pulse-necromancy-zoom.png'), { pad: 40 });
  await page.getByTestId('summon-cancel').click();
});

test('Summon pulse: school ring on opened card in two-card market (#167)', async ({ page }) => {
  const v = await seedFamPair(page);
  expect(v.board.fam_face.filter(Boolean)).toHaveLength(2);

  const trogPeak = freezeSummonPulsePeakWhenReady(page, '0', { timeoutMs: 12000 });
  await page.getByTestId('slot-fam_0').click();
  await expect(page.getByTestId('summon-use')).toBeVisible();
  const trog = await captureLivePulsePeak(page, {
    index: '0',
    rgbRe: /255,\s*210,\s*63/,
    shotPath: 'docs/screenshots/summon-pulse-thaumaturgy-430x775.png',
    peakPromise: trogPeak,
  });
  expect(trog.slug).toContain('summon-pulse-thaumaturgy');
  expect(trog.boxShadow).not.toContain(LEGACY_DEFAULT_BLUE);
  await page.getByTestId('summon-cancel').click();
  await expect(page.getByTestId('summon-use')).toHaveCount(0);

  const nymphPeak = freezeSummonPulsePeakWhenReady(page, '1', { timeoutMs: 12000 });
  await page.getByTestId('slot-fam_1').click();
  await expect(page.getByTestId('summon-use')).toBeVisible();
  const nymph = await captureLivePulsePeak(page, {
    index: '1',
    rgbRe: /95,\s*211,\s*95/,
    shotPath: 'docs/screenshots/summon-pulse-druidry-430x775.png',
    peakPromise: nymphPeak,
  });
  expect(nymph.slug).toContain('summon-pulse-druidry');
  expect(nymph.boxShadow).not.toContain(LEGACY_DEFAULT_BLUE);
});

test('Summon familiar: school pulse class then action tiles (#summon-pulse)', async ({ page }) => {
  const v = await seedSummon(page);
  const cards = await page.evaluate(() => window.lwDebug.cards());
  const fk = v.board.fam_face.find((k) => k && /Imp/i.test(cards[k]?.name || k)) || v.board.fam_face.find((k) => cards[k]?.school === 'Sorcery');
  const slot = v.board.fam_face.indexOf(fk);
  const cardSchool = cards[fk]?.school;
  expect(cardSchool).toBe('Sorcery');

  await page.getByTestId(`slot-fam_${slot}`).click();
  await expect(page.getByTestId('summon-use')).toBeVisible();

  await expect.poll(async () => {
    const st = await page.evaluate(() => ({
      active: document.querySelector('[data-testid="summon-use"]')?.dataset.summonPulse,
      pulse: !!document.querySelector('.big-frame.summon-pulse'),
      slug: document.querySelector('.big-frame.summon-pulse')?.className || '',
    }));
    return st.active === 'active' && st.pulse;
  }, { timeout: 3000 }).toBe(true);
  const pulse = await page.evaluate(() => ({
    slug: document.querySelector('.big-frame.summon-pulse')?.className || '',
  }));

  await captureLivePulsePeak(page, {
    index: String(slot),
    rgbRe: /94,\s*176,\s*255/,
    shotPath: 'docs/screenshots/summon-pulse-430x775.png',
  });

  await expect.poll(async () => {
    const st = await page.evaluate(() => ({
      pending: document.querySelectorAll('.summon-pulse-pending').length,
      pulse: document.querySelectorAll('.big-frame.summon-pulse').length,
      active: document.querySelector('[data-testid="summon-use"]')?.dataset.summonPulse || '',
    }));
    return st.pending === 0 && st.pulse === 0 && st.active === '';
  }, { timeout: 4000 }).toBe(true);
  await expect(page.getByTestId('summon-score')).toBeVisible();
  expect(pulse.slug).toContain('summon-pulse-sorcery');
});

test('Score familiar: school blink and +N gold float (#score-feedback)', async ({ page }) => {
  const v = await seedSummon(page);
  const cards = await page.evaluate(() => window.lwDebug.cards());
  const fk = v.board.fam_face.find((k) => k && /Imp/i.test(cards[k]?.name || k)) || v.board.fam_face.find(Boolean);
  const slot = v.board.fam_face.indexOf(fk);
  const leg = v.legal.summon[fk];
  const expectedGold = (leg?.score_gold || 0) + (leg?.powerful_helper || 0);
  const school = cards[fk]?.school;

  await page.getByTestId('eye-toggle').click();
  await expect(page.getByTestId('inventory')).toBeVisible();

  await page.evaluate(({ k, famGroup, groupIndex }) => {
    window.ui.summonFlow(window.lwDebug._g, k, { group: famGroup, groupIndex });
  }, { k: fk, famGroup: v.board.fam_face.filter(Boolean), groupIndex: slot });

  await expect.poll(async () => (await page.locator('.summon-pulse-pending').count()) === 0, { timeout: 4000 }).toBe(true);
  await page.getByTestId('summon-score').click();

  await expect.poll(async () => page.evaluate((sc) => document.querySelectorAll(
    `#peek-layer .mat.you .mcard.score-school-blink[data-card-school="${sc}"]`,
  ).length, school), { timeout: 3000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('score-gold-float')).toBeVisible({ timeout: 5000 });
  const floats = await page.evaluate(() => ({
    inHuman: document.querySelectorAll('#peek-layer .mat.you [data-testid="score-gold-float"]').length,
    inAi: document.querySelectorAll('.mat:not(.you) [data-testid="score-gold-float"]').length,
    delta: document.querySelector('#peek-layer .mat.you [data-testid="score-gold-float"]')?.dataset.goldDelta,
  }));
  expect(floats.inHuman).toBe(1);
  expect(floats.inAi).toBe(0);
  expect(floats.delta).toBe(String(expectedGold));

  await page.evaluate(({ sc, slug }) => {
    document.querySelectorAll(`#peek-layer .mat.you .mcard[data-card-school="${sc}"]`).forEach((el) => {
      el.classList.add('score-school-blink', `score-school-${slug}`);
      el.style.animationDuration = '8s';
      el.style.animationDelay = '-0.2s';
    });
    const f = document.querySelector('#peek-layer .mat.you [data-testid="score-gold-float"]');
    if (f) { f.style.animationDuration = '8s'; f.style.animationDelay = '-0.35s'; }
  }, { sc: school, slug: 'sorcery' });
  await page.evaluate(() => {
    const you = document.querySelector('#peek-layer .mat.you');
    you?.scrollIntoView({ block: 'center' });
  });
  await page.screenshot({ path: 'docs/screenshots/score-feedback-430x775.png', fullPage: true });

  const blink = await page.evaluate((sc) => ({
    human: document.querySelectorAll(`#peek-layer .mat.you .mcard.score-school-blink[data-card-school="${sc}"]`).length,
    ai: document.querySelectorAll(`.mat:not(.you) .mcard.score-school-blink`).length,
    hand: document.querySelectorAll('.mat-hand .mcard.score-school-blink').length,
    matching: document.querySelectorAll(`#peek-layer .mat.you .mcard[data-card-school="${sc}"]`).length,
  }), school);
  expect(blink.ai).toBe(0);
  expect(blink.hand).toBe(0);
  expect(blink.matching).toBeGreaterThan(0);

  await expect.poll(async () => {
    const left = await page.evaluate(() => ({
      float: document.querySelectorAll('[data-testid="score-gold-float"]').length,
      blink: document.querySelectorAll('.mcard.score-school-blink').length,
    }));
    return left.float === 0 && left.blink === 0;
  }, { timeout: 3000 }).toBe(true);
});

test('Score feedback does not show +N gold when not from human', async ({ page }) => {
  await seedSummon(page);
  await page.getByTestId('eye-toggle').click();
  await expect(page.getByTestId('inventory')).toBeVisible();
  await page.evaluate(() => window.lwDebug.tryScoreFamiliarFeedbackAI('Sorcery', 4));
  expect(await page.getByTestId('score-gold-float').count()).toBe(0);
});