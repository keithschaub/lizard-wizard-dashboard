import fs from 'fs';
import { test, expect } from './fixtures.js';
import { boot } from './helpers.js';

// fixtures/issue-117-perfect-reagent.json: Keith's round 8 save (issue #117). 13InchesOfFun has Perfect Reagent cast,
// 0 Mandrake and 0 Gold; the face-up tower is Ivory Spire T2 (printed 2 Mandrake or 2 Gold).
const SAVE = fs.readFileSync('tests/e2e/fixtures/issue-117-perfect-reagent.json', 'utf8');

test.use({ viewport: { width: 430, height: 775 } });

async function openTower(page, save) {
  await page.addInitScript((t) => localStorage.setItem('lw.save.v1', t), save);
  await boot(page);
  await page.getByTestId('slot-tower_face').first().click();
  await expect(page.getByTestId('card-info')).toBeVisible();
  return page.getByTestId('tower-cost');
}

const fitsWithoutScrolling = (page) => page.evaluate(() => {
  const ei = document.querySelector('.expand-inner');
  return ei.scrollHeight <= ei.clientHeight && document.querySelector('[data-testid=card-info]').getBoundingClientRect().bottom <= innerHeight;
});

test('tower info shows the discounted cost and its cause when it cannot be built', async ({ page }) => {
  const cost = await openTower(page, SAVE);
  await expect(page.getByTestId('build-reagent')).toHaveCount(0);
  await expect(cost.locator('.ci-tower-why')).toHaveText(['Perfect Reagent: 1 fewer reagent']);
  const row = cost.locator('.card-cost-row');
  await expect(row).toHaveText(/^Cost\s*×1\s*or\s*2$/);
  await expect(row.locator('.log-reagent-chip img')).toHaveAttribute('src', /Mandrake/);
  await expect(row.locator('.log-value-chip .log-value-orb.gold')).toHaveCount(1);
  await expect(page.getByTestId('card-info')).not.toContainText(/Cost 2|you have|Your|[+−-]\d/);
  expect(await fitsWithoutScrolling(page)).toBe(true);
});

test('with the Build button showing, the panel gives only the cause', async ({ page }) => {
  const s = JSON.parse(SAVE);
  s.players.find((p) => p.name === '13InchesOfFun').tok.push('Mandrake');
  const cost = await openTower(page, JSON.stringify(s));
  await expect(page.getByTestId('build-reagent')).toContainText('Build with reagents');
  await expect(page.getByTestId('build-reagent')).toContainText('×1');
  await expect(cost.locator('.ci-tower-why')).toHaveText(['Perfect Reagent: 1 fewer reagent']);
  await expect(cost.locator('.card-cost-row')).toHaveCount(0);
  expect(await fitsWithoutScrolling(page)).toBe(true);
});
