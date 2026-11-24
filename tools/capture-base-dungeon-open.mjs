#!/usr/bin/env node
/** Capture Jan18_2025 dungeon first-open overlay for backdrop comparison. */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { webkit, devices } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = '/opt/cursor/artifacts';
const SHA = '5a3ea22';

async function main() {
  const worktree = '/tmp/lw-dungeon-base-jan18';
  const serve = spawn('npx', ['serve', '-l', '4177', worktree], { stdio: 'pipe' });
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:4177/');
      if (res.ok) break;
    } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    const browser = await webkit.launch();
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 430, height: 775 }, deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:4177/');
    await page.waitForFunction(() => window.lwDebug?.ready(), {}, { timeout: 60000 });
    await page.evaluate(async () => {
      const s = await (await fetch('engine/game/g8_state.json')).json();
      const fam = s.fam_face.find(Boolean);
      const via = fam.split('/').pop().replace(/\.jpg$/, '');
      const filler = { deck: 'Dungeon', type: 'Treasure', subtype: 'Gold', gold: 1, text: 'Collect 1 Gold' };
      s.dungeon_list = [{ deck: 'Dungeon', type: 'Monster', name: 'Orc', monster_type: 'Goblinoid' }, ...Array(20).fill(filler)];
      const me = s.players.find((p) => p.name === 'Keith');
      me.mana = 50;
      s.next = 'Keith';
      s.meta.web_pending = { type: 'dungeon', via, draws: 0 };
      const r = await window.lwDebug._g.call('load', { text: JSON.stringify(s) });
      window.lwDebug._g.setView(r.result);
      void window.ui.dungeonFlow(window.lwDebug._g);
    });
    await page.waitForSelector('[data-testid="dungeon"]', { timeout: 10000 });
    await page.getByTestId('dungeon').screenshot({
      path: path.join(ARTIFACTS, 'dungeon-base-jan18-open-430.png'),
      scale: 'device',
    });
    await browser.close();
    console.log('wrote', path.join(ARTIFACTS, 'dungeon-base-jan18-open-430.png'), `from ${SHA}`);
  } finally {
    serve.kill('SIGTERM');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });