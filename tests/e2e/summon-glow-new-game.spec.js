// Issue #167 regression: summon school glow must match the opened card after New game (no reload).
// Per game: stay on round 1 only — open summon chooser on familiars 0 and 1, assert pulse, cancel
// (never commit a summon or play through the round). Then Menu → New game with no page reload.
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';
import { SCHOOL_GLOW } from '../../app/js/school-glow-colors.js';
import { freezeSummonPulsePeakWhenReady } from './summon-pulse-freeze.js';
import fs from 'fs';

test.use({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });

/** School for a board card key — from engine carddb, not the in-app pulse code path. */
async function schoolFromCarddb(page, cardKey) {
  return page.evaluate(async (key) => {
    const raw = await (await fetch('engine/cards/carddb.json')).json();
    const db = raw.cards || raw;
    const base = key.replace(/^.*\//, '');
    const bare = base.endsWith('.jpg') ? base.slice(0, -4) : base;
    const entry = db[key] || db[base] || db[`${bare}.jpg`] || db[bare];
    return entry?.school ?? null;
  }, cardKey);
}

function rgbReFromSchoolName(school) {
  const pulse = SCHOOL_GLOW[school]?.pulse;
  if (!pulse) throw new Error(`No pulse RGB for school ${school}`);
  return new RegExp(`${pulse[0]},\\s*${pulse[1]},\\s*${pulse[2]}`);
}

async function famKeysInOrder(page) {
  return page.evaluate(() => {
    const v = window.lwDebug.view();
    return (v.board.fam_face || []).filter(Boolean);
  });
}

async function waitSummonOverlayReady(page) {
  await expect.poll(async () => page.evaluate(() => {
    const ov = document.querySelector('[data-testid="summon-use"]');
    if (!ov || ov.classList.contains('out')) return false;
    return parseFloat(getComputedStyle(ov).opacity) >= 0.99;
  }), { timeout: 3000 }).toBe(true);
}

async function assertPulseMatchesSchool(page, { groupIndex, school, label, shotPath = null }) {
  const rgbRe = rgbReFromSchoolName(school);
  const peak = await freezeSummonPulsePeakWhenReady(page, groupIndex, { timeoutMs: 12000 });
  expect(peak.ok, `${label}: ${JSON.stringify(peak)}`).toBe(true);
  expect(peak.boxShadow, `${label}: shadow ${peak.boxShadow}`).not.toBe('none');
  expect(peak.boxShadow, `${label}: boxShadow ${peak.boxShadow}`).toMatch(rgbRe);

  const sample = await page.evaluate((idx) => {
    const frame = document.querySelector(`.big-frame.summon-pulse[data-index="${idx}"]`)
      || document.querySelector(`.big-frame.summon-pulse[data-index="${String(idx)}"]`);
    const img = frame?.querySelector('img.big');
    return {
      index: frame?.dataset.index,
      slug: frame?.className ?? '',
      alt: img?.getAttribute('alt'),
      boxShadow: img ? getComputedStyle(img).boxShadow : null,
    };
  }, groupIndex);

  expect(sample.boxShadow, `${label}: no img boxShadow`).not.toBeNull();
  expect(sample.boxShadow, `${label}: boxShadow ${sample.boxShadow}`).toMatch(rgbRe);
  const slug = school.toLowerCase().replace(/[^a-z]/g, '');
  expect(sample.slug, `${label}: class ${sample.slug}`).toContain(`summon-pulse-${slug}`);
  const cardSchool = await schoolFromCarddb(page, sample.alt);
  expect(cardSchool, `${label}: carddb school for ${sample.alt}`).toBe(school);

  if (shotPath) {
    fs.mkdirSync('docs/screenshots', { recursive: true });
    await page.screenshot({ path: shotPath, fullPage: true });
    fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
    await page.screenshot({ path: `/opt/cursor/artifacts/${shotPath.replace(/^.*\//, '')}`, fullPage: true });
  }
  await waitSummonOverlayReady(page);
  return sample;
}

async function openSummonSlot(page, slotIndex) {
  const fams = await famKeysInOrder(page);
  expect(fams[slotIndex], `no familiar at slot ${slotIndex}`).toBeTruthy();
  await page.getByTestId(`slot-fam_${slotIndex}`).click();
  await expect(page.getByTestId('summon-use')).toBeVisible();
  const groupIndex = fams.indexOf(fams[slotIndex]);
  return { cardKey: fams[slotIndex], groupIndex };
}

async function cancelSummon(page) {
  await page.getByTestId('summon-cancel').click();
  await expect(page.getByTestId('summon-use')).toHaveCount(0);
}

async function assertRoundOneNoSummon(page, label) {
  await expect.poll(async () => page.evaluate(() => {
    const v = window.lwDebug.view();
    const me = v.players.find((p) => p.you);
    const fams = (v.board.fam_face || []).filter(Boolean);
    const summonLegal = fams.some((k) => (v.legal?.summon || {})[k]);
    return v.round === 1 && v.next === me?.name && summonLegal;
  }), { timeout: 5000 }).toBe(true);
  const snap = await page.evaluate(() => {
    const v = window.lwDebug.view();
    return { round: v.round, fams: (v.board.fam_face || []).filter(Boolean).length };
  });
  expect(snap.round, `${label}: must stay on round 1`).toBe(1);
  expect(snap.fams, `${label}: need two market familiars`).toBe(2);
}

async function assertBothFamiliars(page, passLabel, { shots = [] } = {}) {
  await assertRoundOneNoSummon(page, passLabel);
  for (const slot of [0, 1]) {
    const { cardKey, groupIndex } = await openSummonSlot(page, slot);
    const school = await schoolFromCarddb(page, cardKey);
    expect(school, `${passLabel} slot ${slot} school`).toBeTruthy();
    await assertPulseMatchesSchool(page, {
      groupIndex,
      school,
      label: `${passLabel} slot ${slot} (${cardKey} → ${school})`,
      shotPath: shots[slot] ?? null,
    });
    await cancelSummon(page);
    await assertRoundOneNoSummon(page, `${passLabel} after cancel slot ${slot}`);
  }
}

async function startNewGameQuick(page, { seeds, picks = ['Eye_of_Newt', 'Horn'] } = {}) {
  if (seeds) await page.evaluate((s) => window.lwDebug.seedNextGame(s), seeds);
  await page.evaluate(() => document.querySelectorAll('#overlays .overlay').forEach((o) => o.remove()));
  await page.getByTestId('btn-menu').click();
  await expect(page.getByTestId('menu-new-game')).toBeVisible();
  await page.getByTestId('menu-new-game').click();
  await expect(page.getByTestId('game-setup')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('setup-quick-start').click();
  await expect(page.getByTestId('new-game-hand')).toBeVisible({ timeout: 60_000 });
  for (const p of picks) await page.getByTestId(`pick-${p}`).click();
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => window.lwDebug.view().round === 1, null, { timeout: 30_000 });
  await page.evaluate(() => window.lwDebug.seedNextGame(null));
}

test('Summon glow: round-1 chooser only, then three New games in one session (#167)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('lw.save.v1');
    localStorage.setItem('lw.setup.v1', JSON.stringify({
      human_name: 'Keith', player_count: 3,
      ais: [{ name: 'Newt', level: 'normal' }, { name: 'LizWiz', level: 'normal' }],
    }));
  });
  await boot(page);

  const games = [
    { seed: 91_100, board_seed: 91_100, ai_seed: 91_101 },
    { seed: 120_001, board_seed: 120_001, ai_seed: 120_002 },
    { seed: 88_442, board_seed: 88_442, ai_seed: 88_443 },
    { seed: 77_019, board_seed: 77_019, ai_seed: 77_020 },
  ];

  for (let i = 0; i < games.length; i++) {
    await startNewGameQuick(page, { seeds: games[i] });
    await page.evaluate(() => {
      const me = window.lwDebug._g.v.players.find((p) => p.you);
      if (me) me.mana = 50;
    });
    const shots = i === 1 ? [
      'docs/screenshots/summon-glow-newgame2-fam0-430x775.png',
      'docs/screenshots/summon-glow-newgame2-fam1-430x775.png',
    ] : [];
    await assertBothFamiliars(page, `game${i + 1}-seed${games[i].board_seed}`, { shots });
  }
});

/** Deferred intro pulse + carousel swipe: stale open-index school vs shown card (regresses #167). */
test('Summon glow on swiped card uses the shown familiar school (#167)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('lw.save.v1');
    localStorage.setItem('lw.setup.v1', JSON.stringify({
      human_name: 'Keith', player_count: 3,
      ais: [{ name: 'Newt', level: 'normal' }, { name: 'LizWiz', level: 'normal' }],
    }));
    const orig = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => orig(() => setTimeout(cb, 280));
  });
  await boot(page);
  await startNewGameQuick(page, { seeds: { seed: 120_001, board_seed: 120_001, ai_seed: 120_002 } });
  await page.evaluate(() => {
    const me = window.lwDebug._g.v.players.find((p) => p.you);
    if (me) me.mana = 50;
  });
  const fams = await famKeysInOrder(page);
  const school0 = await schoolFromCarddb(page, fams[0]);
  const school1 = await schoolFromCarddb(page, fams[1]);
  const peakPromise = freezeSummonPulsePeakWhenReady(page, 1, { timeoutMs: 15000 });
  await page.getByTestId('slot-fam_0').click();
  await expect(page.getByTestId('summon-use')).toBeVisible();
  const box = await page.locator('[data-testid="card-track"]').boundingBox();
  const y = box.y + box.height * 0.4;
  await page.waitForTimeout(20);
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.15, y, { steps: 4 });
  await page.mouse.up();
  const peak = await peakPromise;
  expect(peak.ok, JSON.stringify(peak)).toBe(true);
  const rgb1 = SCHOOL_GLOW[school1].pulse;
  const rgb0 = SCHOOL_GLOW[school0].pulse;
  const re1 = new RegExp(`${rgb1[0]},\\s*${rgb1[1]},\\s*${rgb1[2]}`);
  const re0 = new RegExp(`${rgb0[0]},\\s*${rgb0[1]},\\s*${rgb0[2]}`);
  expect(peak.boxShadow, `slug=${peak.slug} shadow=${peak.boxShadow}`).not.toBe('none');
  expect(peak.boxShadow, `slug=${peak.slug} shadow=${peak.boxShadow}`).toMatch(re1);
  expect(re0.test(peak.boxShadow), `stale ${school0} glow`).toBe(false);
  await cancelSummon(page);
});