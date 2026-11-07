import { test, expect } from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function waitForBoard(page) {
  await page.waitForFunction(() => window.lwDebug && window.lwDebug.ready(), null, { timeout: 60_000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1' &&
    getComputedStyle(document.getElementById('loader')).opacity === '0', null, { timeout: 10_000 });
}

test('Trap spell AI banner is a sentence, not raw JSON', async ({ page }) => {
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
  await expect(page.getByTestId('ai-banner-text')).toContainText('Newt cast Trap');
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
  await expect(page.getByTestId('ai-gather-bonus')).toContainText('bonus');
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
  await expect(page.getByTestId('ai-sell-reagent')).toContainText('2 Mandrake');
  await expect(page.getByTestId('ai-sell-mana')).toContainText('+24 mana');
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
  await expect(page.getByTestId('ai-sell-mana')).toContainText('+32 mana');
  await expect(page.getByTestId('ai-sell-structured')).not.toContainText('track now');
  await page.getByTestId('ai-banner').screenshot({ path: 'docs/screenshots/banner-sell-multi-dpr3.png' });
});

test('all structured AI banner types fit on iPhone at DPR3', async ({ page }) => {
  await page.goto('/');
  await waitForBoard(page);
  const cases = [
    ['research', 'Newt researched', [{ label: 'Transmutation Mastery', card: 'Spell_Transmutation_Mastery.jpg' }]],
    ['cast', 'Newt cast', [{ label: 'Energy Pulse', card: 'Spell_Energy_Pulse.jpg' }]],
    ['new-research', 'Newt used New Research', [{ label: 'Transmutation Mastery', card: 'Spell_Transmutation_Mastery.jpg' }]],
    ['summon', 'LizWiz summoned', [{ label: 'Reptilius Venenum', card: 'Familiar_12_Reptilius_Venenum.jpg' }, { label: '-5 mana' }]],
    ['build', 'Newt built', [{ label: 'The Ivory Spire', card: 'Tower_T1_Ivory_Spire.jpg' }, { label: '-Mandrake' }]],
    ['auction', 'Rex won the auction', [{ label: 'Draco Mortemus', card: 'Wizard_Draco_Mortemus.jpg' }, { label: '-8 mana' }]],
    ['auction-nobid', 'Newt auction: no bid', [{ label: 'Draco Mortemus', card: 'Wizard_Draco_Mortemus.jpg' }]],
    ['dungeon', 'Gecko entered the dungeon', [{ label: 'The Longest Card Name Kept' }]],
    ['scry-dungeon', 'Newt scried the Dungeon', [{ label: 'The Longest Card Name Kept' }]],
    ['scry-familiars', 'Newt scried', [{ label: 'Familiars' }]],
    ['convert1', 'Newt sold', [{ label: '-3 reagents' }, { label: '+3 mana' }]],
    ['transmute', 'Newt transmuted', [{ label: '-4 reagents' }, { label: '+2 Gold' }]],
    ['transform', 'Newt transformed', [{ label: 'Horn + Mandrake → Sulphur' }]],
    ['time-shift', 'Newt cast Time Shift', [{ label: 'spells' }]],
    ['wand-tax', 'Newt cast Wand Tax', [{ label: '+3 Gold' }]],
    ['energy-pulse', 'Newt cast Energy Pulse', [{ label: '2 Spell Shields' }]],
    ['invisibility', 'Newt cast Invisibility Potion', [{ label: '+4 Gold' }]],
    ['invisibility-blocked', 'Newt cast Invisibility Potion', [{ label: 'blocked' }]],
    ['trap', 'Newt cast Trap', [{ label: 'trap added' }]],
    ['demonic', 'Newt used Demonic Possession', [{ label: 'Reptilius Venenum' }]],
    ['obscure', 'Newt used Obscure', []],
    ['evolve', 'Newt evolved', [{ label: 'Vulpes' }, { label: 'Draco Mortemus' }]],
    ['rise', 'Newt reactivated', [{ label: 'Vulpes' }, { label: 'gather' }]],
    ['crystal', 'Newt used Crystal Ball', [{ label: '+3 cards' }]],
    ['flame-bolt', 'Newt cast Flame Bolt', [{ label: 'The Longest Card Name' }]],
    ['disintegrate', 'Newt cast Disintegrate', [{ label: 'The Longest Card Name' }]],
    ['earthquake', 'Newt cast Earthquake', [{ label: 'The Longest Card Name' }]],
    ['charm', 'Newt cast Charm', [{ label: 'The Longest Card Name' }]],
    ['mana-drain', 'Newt cast Mana Drain', [{ label: '5 mana drained' }]],
    ['trigger', 'Newt cast Trigger', [{ label: '+3 mana' }]],
    ['shield-used', 'Newt cast Shield Used', [{ label: 'Spell Shield' }]],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [name, headline, chips] = cases[i];
    await page.evaluate(({ name, headline, chips }) => {
      const g = window.lwDebug._g;
      g.skipMove = true;
      window.ui.banner(g, {
        r: 10, who: 'Newt', act: name,
        text: `${headline}: fallback`,
        structured: { headline, chips, cards: [] },
      }, 0, 1);
    }, { name, headline, chips });
    await expect(page.getByTestId('ai-structured')).toBeVisible();
    await expect(page.getByTestId('ai-structured')).toContainText(headline);
    await page.getByTestId('ai-banner').screenshot({ path: `/tmp/ai-banner-tiles/${String(i).padStart(2, '0')}-${name}.png` });
  }
});
