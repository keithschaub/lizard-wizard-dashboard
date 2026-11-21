import { h, art, nice, schoolIcon, appendNodes, replaceChildren } from './dom.js';
import { openOverlay, expandCard, closeAll } from './ui.js';
import { SPELL_SCROLL_ICON } from './achievements.js';
import * as Store from './store.js';

// Playtest: a new game with chosen starting mana and gold, face-up spells, wizards and tower, starting hand and
// inventory. Opened by a long press on the version number in the menu. The engine deals the rest (playtest_start).
const DIE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.5" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.5" fill="currentColor"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
const FLASK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6.2L4.8 18.4A2 2 0 0 0 6.6 21h10.8a2 2 0 0 0 1.8-2.6L14 9.2V3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><path d="M7.4 15h9.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10.5" cy="17.6" r="1" fill="currentColor"/><circle cx="13.6" cy="18.4" r=".8" fill="currentColor"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ADD = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="12" height="16" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="6" width="11" height="15" rx="2.2" fill="rgba(15,22,52,.9)" stroke="currentColor" stroke-width="1.6"/></svg>';
const SCHOOLS = ['Alchemy', 'Conjuring', 'Druidry', 'Enchantment', 'Necromancy', 'Sorcery', 'Thaumaturgy'];
const SLOTS = [
  { field: 'spells', n: 4, decks: ['Spell'], title: 'Spell', label: 'Spells' },
  { field: 'wizards', n: 2, decks: ['Wizard'], title: 'Wizard', label: 'Wizards' },
  { field: 'tower', n: 1, decks: ['Tower'], title: 'Tower', label: 'Tower' },
  { field: 'hand', n: 3, decks: ['Reagent'], title: 'Hand', label: 'Hand' },
];
const INVENTORY = { field: 'inventory', decks: ['Spell', 'Wizard', 'Tower', 'Familiar'], title: 'Inventory', label: 'Inventory' };

/** Long press (about 0.6 s) on `el` calls `fn`; a normal tap does nothing new. */
export function bindLongPress(el, fn, ms = 600) {
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', () => { stop(); timer = setTimeout(() => { timer = null; fn(); }, ms); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, stop);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

const svg = (cls, html) => h('span', { class: cls, html });
const ic = (src, cls = 'pt-ic') => h('img', { class: cls, src, alt: '' });

export function openPlaytest(g) {
  const st = { mana: 20, gold: 0, spells: [null, null, null, null], wizards: [null, null], tower: [null], hand: [null, null, null], inventory: [] };
  const ov = openOverlay('sheet pt', { testid: 'playtest' });
  const panel = h('div', { class: 'pt-panel', 'data-testid': 'pt-panel' });
  appendNodes(ov.el, panel);
  const num = (name, orb) => {
    const input = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 999, value: st[name], 'aria-label': nice(name), 'data-testid': `pt-${name}` });
    input.oninput = () => { st[name] = input.value; };
    return h('label', { class: 'pt-num' }, input, h('span', { class: `log-value-orb ${orb}` }));
  };
  const tile = (k, testid, onclick, { add = false } = {}) => {
    if (!k) {
      return h('button', { class: `pt-slot ${add ? 'add' : 'rnd'}`, 'data-testid': testid, onclick },
        svg('pt-die', add ? ADD : DIE), h('span', { class: 'pt-rl' }, add ? 'Add' : 'Random'));
    }
    const info = g.cards[k] || {};
    return h('button', { class: 'pt-slot on', 'data-testid': testid, 'data-key': k, onclick },
      h('img', { class: 'pt-art', src: art(k), alt: info.name || nice(k) }), svg('pt-check', CHECK),
      h('span', { class: 'pt-band' }, info.school && SCHOOLS.includes(info.school) ? ic(schoolIcon(info.school), 'pt-school') : null, h('span', {}, info.name || nice(k))));
  };
  const head = (icon, label) => h('div', { class: 'pt-lab' }, icon, h('span', {}, label));
  const slotRow = (spec) => h('div', { class: 'pt-row' }, st[spec.field].map((k, i) => tile(k, `pt-${spec.field}-${i}`, async () => {
    const pick = await openPicker(g, { ...spec, title: spec.n > 1 ? `${spec.title} ${i + 1}` : spec.title, current: k });
    if (pick === undefined) return;
    st[spec.field][i] = pick; draw();
  })));
  const inventoryRow = () => h('div', { class: 'pt-row wrap' },
    st.inventory.map((k, i) => tile(k, `pt-inventory-${i}`, async () => {
      const pick = await openPicker(g, { ...INVENTORY, current: k, removable: true });
      if (pick === undefined) return;
      if (pick) st.inventory[i] = pick; else st.inventory.splice(i, 1);
      draw();
    })),
    tile(null, 'pt-inventory-add', async () => {
      const pick = await openPicker(g, { ...INVENTORY, current: null, removable: true });
      if (pick) { st.inventory.push(pick); draw(); }
    }, { add: true }));
  const start = h('button', { class: 'act pt-start', 'data-testid': 'pt-start' }, 'Start');
  start.onclick = async () => {
    start.disabled = true;
    const forced = { mana: st.mana, gold: st.gold, spells: st.spells, wizards: st.wizards, tower: st.tower[0], hand: st.hand, inventory: st.inventory };
    const r = await g.call('playtest_start', { forced, config: Store.loadSetup() || Store.defaultSetup() });
    if (!r.ok) { g.toast(r.error); start.disabled = false; return; }
    closeAll();
    g.startedNewGame(r.view);
  };
  const spec = (f) => SLOTS.find((s) => s.field === f);
  const draw = () => {
    const inv = h('div', {}, head(svg('pt-ic', EYE), 'Inventory'), inventoryRow());
    replaceChildren(panel,
      h('div', { class: 'pt-top' }, svg('pt-badge', FLASK), h('span', { class: 'pt-title' }, 'Playtest'),
        h('button', { class: 'ov-close pt-x', 'aria-label': 'Close', 'data-testid': 'pt-close', onclick: () => ov.close() }, '×')),
      h('div', { class: 'pt-money' }, num('mana', 'mana'), num('gold', 'gold')),
      h('section', { class: 'pt-sec' }, head(svg('pt-ic', SPELL_SCROLL_ICON), 'Spells'), slotRow(spec('spells'))),
      h('section', { class: 'pt-sec pt-split' },
        h('div', {}, head(ic('art/icons/achievement-wizard.webp'), 'Wizards'), slotRow(spec('wizards'))),
        h('div', {}, head(ic('art/icons/achievement-tower.webp'), 'Tower'), slotRow(spec('tower')))),
      st.inventory.length
        ? [h('section', { class: 'pt-sec' }, head(ic(art('Reagent_05'), 'pt-ic card'), 'Hand'), slotRow(spec('hand'))), h('section', { class: 'pt-sec' }, inv)]
        : h('section', { class: 'pt-sec pt-split' }, h('div', {}, head(ic(art('Reagent_05'), 'pt-ic card'), 'Hand'), slotRow(spec('hand'))), inv),
      start);
  };
  draw();
  return ov;
}

// Card picker for one slot: resolves with the chosen card key, null for Random (or Remove), undefined when closed.
function openPicker(g, { title, decks, current = null, removable = false }) {
  return new Promise((resolve) => {
    const ov = openOverlay('sheet pt', { testid: 'playtest-picker' });
    const all = Object.values(g.cards).filter((c) => decks.includes(c.deck)).sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));
    const hasSchools = all.some((c) => SCHOOLS.includes(c.school));
    let school = null; let choice = current; let done = false;
    const finish = (v) => { if (done) return; done = true; ov.close(); resolve(v); };
    const grid = h('div', { class: 'pk-grid', 'data-testid': 'pk-grid' });
    const chips = h('div', { class: 'pk-schools' });
    const sel = h('div', { class: 'pk-sel', 'data-testid': 'pk-choice' });
    const shown = () => all.filter((c) => !school || c.school === school);
    const drawChips = () => replaceChildren(chips,
      h('button', { class: `pk-chip ${school ? '' : 'on'}`, 'data-testid': 'pk-school-all', onclick: () => { school = null; drawAll(); } }, 'All'),
      SCHOOLS.map((s) => h('button', { class: `pk-chip ic ${school === s ? 'on' : ''}`, 'aria-label': s, 'data-testid': `pk-school-${s}`, onclick: () => { school = s; drawAll(); } },
        h('img', { src: schoolIcon(s), alt: s }))));
    const drawSel = () => {
      const info = choice ? g.cards[choice] || {} : null;
      replaceChildren(sel, info ? [h('img', { class: 'pk-mini', src: art(choice), alt: '' }), h('span', {}, info.name || nice(choice)),
        SCHOOLS.includes(info.school) ? h('img', { class: 'pt-school', src: schoolIcon(info.school), alt: info.school }) : null] : null);
      go.disabled = !choice;
    };
    const drawGrid = () => {
      const list = shown(); const keys = list.map((c) => c.key);
      replaceChildren(grid, list.map((c, i) => h('button', { class: `pk-card ${c.key === choice ? 'on' : ''}`, 'data-testid': `pk-card-${c.key}`, 'data-key': c.key,
        onclick: () => expandCard(g, c.key, {
          group: keys, groupIndex: i,
          actions: (k) => [{ label: 'Select', testid: 'pk-select', onClick: () => { choice = k; drawGrid(); drawSel(); } }],
        }) },
      h('img', { src: art(c.key), alt: c.name || c.key }), c.key === choice ? svg('pt-check', CHECK) : null)));
    };
    const drawAll = () => { drawChips(); drawGrid(); };
    const go = h('button', { class: 'act pk-go', 'data-testid': 'pk-choose', onclick: () => finish(choice) }, 'Choose');
    const rnd = h('button', { class: 'act secondary pk-rnd', 'data-testid': 'pk-random', onclick: () => finish(null) },
      removable ? null : svg('pt-die', DIE), removable ? 'Remove' : 'Random');
    appendNodes(ov.el, h('div', { class: 'pk-panel', 'data-testid': 'pk-panel' },
      h('div', { class: 'pt-top' }, h('span', { class: 'pt-title' }, title),
        h('button', { class: 'ov-close pt-x', 'aria-label': 'Close', 'data-testid': 'pk-close', onclick: () => finish(undefined) }, '×')),
      hasSchools ? chips : null, grid,
      h('div', { class: 'pk-bar' }, sel, rnd, go)));
    drawAll(); drawSel();
    if (choice) requestAnimationFrame(() => { const c = grid.querySelector(`[data-key="${choice}"]`); if (c) grid.scrollTop = c.offsetTop - grid.offsetTop - 70; });
  });
}
