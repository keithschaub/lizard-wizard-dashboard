import { test, expect } from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function waitForBoard(page) {
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1' &&
    getComputedStyle(document.getElementById('loader')).opacity === '0', null, { timeout: 10_000 });
}

test('Trap spell AI banner is structured, not raw JSON', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  const text = await page.evaluate(async () => {
    const g = window.lwDebug._g;
    const dump = await g.call('dump');
    const s = JSON.parse(dump.result);
    s.meta.log.push({ r: 10, who: 'Newt', act: 'trap_spell' });
    const loaded = await g.call('load', { text: JSON.stringify(s) });
    g.setView(loaded.result);
    const log = await g.call('full_log');
    const entry = log.result.at(-1);
    window.ui.banner(g, entry, 0, 1);
    return entry.text;
  });
  expect(text).toContain('Newt cast Trap');
  expect(text).not.toContain('{');
  await expect(page.getByTestId('ai-banner-text')).toContainText('Newt set a Trap');
  await expect(page.getByTestId('ai-banner-text')).not.toContainText('{');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screenshots/banner-trap-dpr3.png', fullPage: true });
});

async function showGather(page, gather) {
  await page.evaluate(async (gather) => {
    const g = window.lwDebug._g;
    window.ui.banner(g, {
      r: 10, who: 'Newt', act: 'gather',
      text: `Newt gathered ${gather.reagents.join(', ')}`,
      gather,
    }, 0, 1);
  }, gather);
  await expect(page.getByTestId('ai-gather-structured')).toBeVisible();
}

async function showSell(page, sell) {
  await page.evaluate(async (sell) => {
    const g = window.lwDebug._g;
    window.ui.banner(g, {
      r: 10, who: 'Gecko', act: 'convert',
      text: 'Gecko sold 2 Mandrake at 12 each (+24 mana); track now 10',
      sell,
    }, 0, 1);
  }, sell);
  await expect(page.getByTestId('ai-sell-structured')).toBeVisible();
}

test('structured short gather banner keeps reagent chips and tracks readable', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  await showGather(page, { reagents: ['Horn'], bonus: [], tracks: ['Horn'] });
  await expect(page.getByTestId('ai-gather-reagent')).toHaveCount(1);
  await expect(page.getByTestId('ai-gather-track')).toHaveCount(1);
  await expect(page.getByTestId('ai-gather-structured')).toContainText('Newt gathered');
  await expect(page.getByTestId('ai-gather-structured')).toContainText('Tracks up:');
  await page.getByTestId('ai-banner').screenshot({ path: 'docs/screenshots/banner-gather-short-dpr3.png' });
});

test('structured long gather banner wraps four reagents and tracks without clipping', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  await showGather(page, {
    reagents: ['Sulphur', 'Mandrake', 'Horn', 'Eye_of_Newt'],
    bonus: ['Sulphur'],
    tracks: ['Sulphur', 'Mandrake', 'Horn', 'Eye_of_Newt'],
  });
  await expect(page.getByTestId('ai-gather-reagent')).toHaveCount(4);
  await expect(page.getByTestId('ai-gather-reagent').filter({ hasText: '×2' })).toHaveCount(1);
  await expect(page.getByTestId('ai-gather-bonus')).toHaveCount(0);
  await expect(page.locator('.bgather-name')).toHaveCount(0);
  await expect(page.getByTestId('ai-gather-track')).toHaveCount(4);
  const banner = page.getByTestId('ai-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveCSS('background-color', 'rgb(12, 17, 44)');
  const box = await banner.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.getByTestId('ai-banner').screenshot({ path: 'docs/screenshots/banner-gather-long-dpr3.png' });
});

test('structured single-type sell banner shows reagent and mana gain', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  await showSell(page, { sales: [{ reagent: 'Mandrake', n: 2, value: 12 }], mana: 24 });
  await expect(page.getByTestId('ai-sell-reagent')).toContainText('×2');
  await expect(page.getByTestId('ai-sell-reagent')).not.toContainText('Mandrake');
  await expect(page.getByTestId('ai-sell-structured')).toContainText('Mandrake 12 each');
  await expect(page.getByTestId('ai-sell-mana').locator('.log-value-number')).toHaveText('24');
  await expect(page.getByTestId('ai-sell-structured')).not.toContainText('track now');
  await page.getByTestId('ai-banner').screenshot({ path: 'docs/screenshots/banner-sell-single-dpr3.png' });
});

test('structured multi-type sell banner uses one chip per type and one total gain', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  await showSell(page, {
    sales: [
      { reagent: 'Mandrake', n: 2, value: 12 },
      { reagent: 'Horn', n: 1, value: 8 },
    ],
    mana: 32,
  });
  await expect(page.getByTestId('ai-sell-reagent')).toHaveCount(2);
  await expect(page.getByTestId('ai-sell-structured')).toContainText('Mandrake 12 each · Horn 8 each');
  await expect(page.getByTestId('ai-sell-mana').locator('.log-value-number')).toHaveText('32');
  await expect(page.getByTestId('ai-sell-structured')).not.toContainText('track now');
  await page.getByTestId('ai-banner').screenshot({ path: 'docs/screenshots/banner-sell-multi-dpr3.png' });
});

test('structured auction and summon banners use number-first value chips', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  await page.evaluate(() => {
    const g = window.lwDebug._g;
    g.skipMove = true;
    window.ui.banner(g, {
      r: 10, who: 'Newt', act: 'auction', text: 'Newt won the auction',
      structured: {
        headline: 'Newt won the auction',
        chips: [{ label: '−8 mana', mana: -8 }, { label: '+120 Gold', gold: 120 }],
        cards: [],
      },
    }, 0, 1);
  });
  await expect(page.getByTestId('ai-structured').locator('.log-value-number')).toHaveText(['8', '120']);
  await expect(page.getByTestId('ai-structured').locator('img[src*="mana-orb"], img[src*="gold-token"]')).toHaveCount(0);
});

test('pending banner payloads do not throw while arrays are unavailable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForBoard(page);
  await page.evaluate(() => {
    const g = window.lwDebug._g;
    window.ui.banner(g, {
      r: 10, who: 'Newt', act: 'gather', text: 'Newt is gathering',
      gather: { reagents: null, bonus: null, tracks: null },
      sell: { sales: null, mana: 0 },
      structured: { headline: 'Pending', chips: null },
    }, 0, 1);
  });
  await expect(page.getByTestId('ai-banner')).toBeVisible();
  expect(errors).toEqual([]);
});

test('all structured AI banner types fit on iPhone at DPR3', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  const cases = [
    ['research', 'Newt', 'Newt researched', [{ label: 'Trap', card: 'Spell_Trap' }]],
    ['cast', 'Gecko', 'Gecko cast', [{ label: 'Energy Pulse', card: 'Spell_Energy_Pulse' }]],
    ['new-research', 'LizWiz', 'LizWiz researched', [{ label: 'Transmutation', card: 'Spell_Transmute' }]],
    ['summon', 'LizWiz', 'LizWiz summoned', [{ label: 'Vulpes', card: 'Familiar_10_Vulpes' }, { label: '-5 mana', mana: -5 }]],
    ['build', 'Newt', 'Newt built', [{ label: 'The Ivory Spire', card: 'Tower_T1_Ivory_Spire' }, { label: '-2 Mandrake', reagent: 'Mandrake' }]],
    ['auction', 'Rex', 'Rex won the auction', [{ label: 'Draco Mortemus', card: 'Wizard_Draco_Mortemus' }, { label: '-8 mana', mana: -8 }]],
    ['auction-nobid', 'Gecko', 'Gecko passed on the auction', [{ label: 'Reptilius Venenum', card: 'Wizard_Reptilius_Venenum' }]],
    ['dungeon', 'Gecko', 'Gecko entered the dungeon', [{ label: 'Reptilius Venenum kept', card: 'Wizard_Reptilius_Venenum' }]],
    ['scry-dungeon', 'LizWiz', 'LizWiz scried the dungeon', [{ label: 'Reptilius Venenum', card: 'Wizard_Reptilius_Venenum' }]],
    ['scry-familiars', 'Newt', 'Newt scried', [{ label: 'Familiars' }]],
    ['convert1', 'Newt', 'Newt sold', [{ label: '3 Sulphur', reagent: 'Sulphur' }, { label: '+3 mana', mana: 3 }]],
    ['transmute', 'Newt', 'Newt transmuted', [{ label: '-2 Horn', reagent: 'Horn' }, { label: '-2 Mandrake', reagent: 'Mandrake' }, { label: '+2 Gold', gold: 2 }]],
    ['transform', 'LizWiz', 'LizWiz transformed', [{ label: 'Horn + Mandrake → Sulphur', reagent: 'Sulphur' }]],
    ['time-shift', 'Newt', 'Newt cast Time Shift', [{ label: 'removed Spell Shield', card: 'Spell_Spell_Shield_T' }]],
    ['wand-tax', 'Rex', 'Rex cast Wand Tax', [{ label: '+3 Gold', gold: 3 }]],
    ['energy-pulse', 'Gecko', 'Gecko cast Energy Pulse', [{ label: '2 Spell Shields', shield: true }]],
    ['invisibility', 'LizWiz', 'LizWiz cast Invisibility Potion', [{ label: '+4 Gold', gold: 4 }]],
    ['invisibility-blocked', 'LizWiz', 'LizWiz cast Invisibility Potion', [{ label: 'blocked', shield: true }]],
    ['trap', 'Newt', 'Newt set a Trap', []],
    ['demonic', 'Rex', 'Rex used Demonic Possession', [{ label: 'Vulpes', card: 'Familiar_10_Vulpes' }]],
    ['obscure', 'Gecko', 'Gecko used Obscure', [{ label: 'target: LizWiz' }]],
    ['evolve', 'LizWiz', 'LizWiz evolved', [{ label: 'Vulpes', card: 'Familiar_10_Vulpes' }, { label: 'Draco Mortemus', card: 'Wizard_Draco_Mortemus' }]],
    ['rise', 'Newt', 'Newt reactivated', [{ label: 'Vulpes', card: 'Familiar_10_Vulpes' }, { label: 'gather' }]],
    ['crystal', 'Rex', 'Rex used Crystal Ball', [{ label: '+3 cards' }]],
    ['flame-bolt', 'Gecko', 'Gecko cast Flame Bolt', [{ label: 'vs LizWiz' }, { label: 'Reptilius Venenum', card: 'Wizard_Reptilius_Venenum' }]],
    ['disintegrate', 'Newt', 'Newt cast Disintegrate', [{ label: 'vs Gecko' }, { label: 'Serpentium Machinus', card: 'Wizard_Serpentium_Machinus' }]],
    ['earthquake', 'LizWiz', 'LizWiz cast Earthquake', [{ label: 'vs Rex' }, { label: 'Serpentium Machinus', card: 'Wizard_Serpentium_Machinus' }]],
    ['charm', 'Rex', 'Rex cast Charm', [{ label: 'vs Newt' }, { label: 'Serpentium Machinus', card: 'Wizard_Serpentium_Machinus' }]],
    ['mana-drain', 'Gecko', 'Gecko cast Mana Drain', [{ label: 'vs Newt' }, { label: '5 mana drained', mana: -5 }]],
    ['shield-used', 'LizWiz', "LizWiz's Spell Shield blocked it", [{ label: 'blocked', shield: true }]],
    ['trigger', 'Newt', 'Newt cast Trigger', [{ label: 'Trigger', card: 'Spell_Mana_Fountain' }, { label: '+3 mana', mana: 3 }]],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [name, who, headline, chips] = cases[i];
    await page.evaluate(({ name, who, headline, chips }) => {
      const g = window.lwDebug._g;
      g.skipMove = true;
      window.ui.banner(g, {
        r: 10, who, act: name,
        text: `${headline}: fallback`,
        structured: { headline, chips, cards: [] },
      }, 0, 1);
    }, { name, who, headline, chips });
    await expect(page.getByTestId('ai-structured')).toBeVisible();
    await expect(page.getByTestId('ai-banner')).toContainText(`${who}'s turn`);
    await expect(page.getByTestId('ai-structured')).toContainText(headline);
    await page.getByTestId('ai-banner').screenshot({ path: `/tmp/ai-banner-tiles/${String(i).padStart(2, '0')}-${name}.png` });
  }
});
