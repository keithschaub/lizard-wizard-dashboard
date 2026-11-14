import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// The expanded card's entrance animation must not change its size. It used to zoom from scale(.6) every time the
// carousel re-rendered (first open and every swipe), so a card caught early in that animation, or a run starved
// of animation frames, measured and looked 60% of its size (Research ~143.8 px instead of ~239.7 px on WebKit).
// Each case freezes every animation on the card at its first frame (the bad condition) and checks the card's
// on-screen width against its layout width and against the settled width.
const TOWER_117 = fs.readFileSync('tests/e2e/fixtures/issue-117-perfect-reagent.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

const openers = {
  research: (g) => window.ui.researchFlow(g, Object.keys(g.v.legal.research)[0]),
  build: (g) => window.ui.buildFlow(g),
};

// Opens the viewer, optionally freezing the card's animations at t=0, and returns its on-screen and layout widths.
async function cardWidth(page, which, { freeze }) {
  return page.evaluate(async ({ which, freeze, src }) => {
    document.querySelectorAll('#overlays .overlay').forEach((o) => o.remove());
    const g = window.lwDebug._g;
    (0, eval)(`(${src})`)(g);
    const freezeAll = () => document.querySelectorAll('.expand .big-frame').forEach((f) => f.getAnimations().forEach((a) => { a.pause(); a.currentTime = 0; }));
    if (freeze) freezeAll();
    await new Promise((r) => setTimeout(r, freeze ? 150 : 900));
    const img = () => document.querySelector('.expand .big-frame[style*="translateX(0%)"] [data-testid=expanded-img]') || document.querySelector('[data-testid=expanded-img]');
    const out = { rect: img().getBoundingClientRect().width, layout: img().offsetWidth };
    const next = document.querySelector('.overlay.expand [data-testid=nav-next]');
    if (next) {
      next.click();
      if (freeze) freezeAll();
      await new Promise((r) => setTimeout(r, freeze ? 150 : 900));
      out.afterSwipe = { rect: img().getBoundingClientRect().width, layout: img().offsetWidth };
    }
    return out;
  }, { which, freeze, src: openers[which].toString() });
}

async function expectStableCard(page, which) {
  const settled = await cardWidth(page, which, { freeze: false });
  const frozen = await cardWidth(page, which, { freeze: true });
  expect(settled.layout).toBeGreaterThan(150);
  expect(Math.abs(frozen.rect - frozen.layout), `${which}: frozen on-screen ${frozen.rect} vs layout ${frozen.layout}`).toBeLessThanOrEqual(2);
  expect(Math.abs(frozen.rect - settled.rect), `${which}: frozen ${frozen.rect} vs settled ${settled.rect}`).toBeLessThanOrEqual(2);
  if (frozen.afterSwipe) {
    expect(Math.abs(frozen.afterSwipe.rect - settled.rect), `${which}: just after a swipe ${frozen.afterSwipe.rect} vs ${settled.rect}`).toBeLessThanOrEqual(2);
  }
}

test('Research carousel card keeps its size while its animation is frozen and after a swipe', async ({ page }) => {
  await boot(page);
  await expectStableCard(page, 'research');
});

test('Build card keeps its size while its animation is frozen', async ({ page }) => {
  await boot(page);
  await expectStableCard(page, 'build');
});

test('#117 case b tower card (Build button showing) keeps its size while its animation is frozen', async ({ page }) => {
  const s = JSON.parse(TOWER_117);
  s.players.find((p) => p.name === '13InchesOfFun').tok.push('Mandrake');
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), JSON.stringify(s));
  await boot(page);
  await expect.poll(() => page.evaluate(() => !!window.lwDebug.view().legal?.build)).toBe(true);
  await expectStableCard(page, 'build');
});
