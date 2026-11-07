import { h, appendNodes } from './dom.js';
import * as Store from './store.js';

function openOverlay(cls, { onScrim = null, testid = null } = {}) {
  const root = document.getElementById('overlays');
  const el = h('div', { class: `overlay ${cls}`, 'data-testid': testid || `ov-${cls.split(' ')[0]}` });
  let closed = false;
  const ov = {
    el,
    close() { if (closed) return; closed = true; el.classList.add('out'); setTimeout(() => el.remove(), 180); },
    get closed() { return closed; },
  };
  if (onScrim) el.addEventListener('click', (e) => { if (e.target === el) onScrim(ov); });
  root.appendChild(el);
  return ov;
}

function closeBtn(fn, testid = 'ov-close') {
  return h('button', { class: 'ov-close', 'aria-label': 'Close', 'data-testid': testid, onclick: (e) => { e.stopPropagation(); fn(); } }, '×');
}

const LEVELS = [
  { id: 'easy', title: 'Apprentice', hint: 'Looser play, shy auctions' },
  { id: 'normal', title: 'Adept', hint: 'Standard opponent' },
  { id: 'hard', title: 'Archmage', hint: 'Ruthless endgame play' },
];

const DEFAULT_AIS = ['Newt', 'LizWiz', 'Gecko'];

function seatIcons(n) {
  return h('div', { class: 'setup-seats', 'aria-hidden': 'true' },
    ...Array.from({ length: n }, (_, i) => h('span', { class: `setup-seat ${i === 0 ? 'you' : 'ai'}` }, i === 0 ? '🧙' : '🦎')));
}

function levelPicker(g, seat, level, onChange) {
  return h('div', { class: 'diff-picker', 'data-testid': `setup-ai-${seat}-levels` },
    ...LEVELS.map((L) => {
      const btn = h('button', {
        type: 'button',
        class: `diff-opt ${level === L.id ? 'on' : ''}`,
        'data-testid': `setup-ai-${seat}-${L.id}`,
        onclick: () => { g.sfx('select'); onChange(L.id); },
      }, h('span', { class: 'diff-title' }, L.title), h('span', { class: 'diff-hint' }, L.hint));
      return btn;
    }));
}

/** Phone-first setup wizard; resolves with a config object or null if cancelled. */
export function runSetupWizard(g) {
  return new Promise((resolve) => {
    const draft = Store.defaultSetup();
    const savedSetup = Store.loadSetup();
    let step = 0;
    const ov = openOverlay('setup-wizard', { onScrim: (o) => { o.close(); resolve(null); }, testid: 'game-setup' });
    const body = h('div', { class: 'setup-body' });
    const steps = h('div', { class: 'setup-steps', 'data-testid': 'setup-step-dots' });
    const titles = ['Your name', 'Table size', 'Opponents'];

    const finish = (config) => {
      ov.close();
      resolve(config);
    };

    const titleEl = () => ov.el.querySelector('[data-testid=setup-title]');
    const go = (n) => {
      step = n;
      titleEl().textContent = titles[step];
      body.innerHTML = '';
      steps.innerHTML = '';
      for (let i = 0; i < 3; i++) steps.appendChild(h('span', { class: `setup-dot ${i === step ? 'on' : ''}` }));
      if (step === 0) paintName();
      else if (step === 1) paintSize();
      else paintAis();
    };

    const paintName = () => {
      const inp = h('input', {
        class: 'setup-name-input',
        type: 'text',
        maxlength: 24,
        'data-testid': 'setup-name-input',
        placeholder: 'Wizard name',
        value: draft.human_name,
        autocapitalize: 'words',
        enterkeyhint: 'next',
      });
      inp.oninput = () => { draft.human_name = inp.value.trim() || 'Keith'; };
      appendNodes(body,
        h('p', { class: 'setup-lead' }, 'One player on this device — choose your wizard name.'),
        inp,
        savedSetup ? h('button', {
          type: 'button',
          class: 'act setup-quick setup-action',
          'data-testid': 'setup-quick-start',
          onclick: () => {
            g.sfx('tap');
            const cfg = Store.defaultSetup();
            Store.saveSetup(cfg);
            finish(cfg);
          },
        }, h('span', { class: 'setup-action-title' }, 'Quick start'),
        h('span', { class: 'setup-action-sub setup-quick-sub' }, 'Last saved setup · 3 players · 2 Adept AIs')) : null,
        h('button', {
          type: 'button',
          class: 'act setup-custom setup-action setup-action-secondary',
          'data-testid': 'setup-custom-game',
          onclick: () => { g.sfx('tap'); go(1); },
        }, h('span', { class: 'setup-action-title' }, 'Custom game'),
        h('span', { class: 'setup-action-sub' }, 'Choose players, AI names & difficulty')));
    };

    const paintSize = () => {
      const tiles = [2, 3, 4].map((n) => {
        const on = draft.player_count === n;
        return h('button', {
          type: 'button',
          class: `setup-tile ${on ? 'on' : ''}`,
          'data-testid': `setup-size-${n}`,
          onclick: () => {
            g.sfx('select');
            draft.player_count = n;
            while (draft.ais.length < n - 1) draft.ais.push({ name: DEFAULT_AIS[draft.ais.length], level: 'normal' });
            draft.ais = draft.ais.slice(0, n - 1);
            go(1);
          },
        }, seatIcons(n), h('span', { class: 'setup-tile-n' }, `${n} players`), h('span', { class: 'setup-tile-sub' }, `${n - 1} AI opponent${n > 2 ? 's' : ''}`));
      });
      appendNodes(body,
        h('p', { class: 'setup-lead' }, 'How many seats at the table?'),
        h('div', { class: 'setup-tiles' }, tiles),
        h('button', {
          type: 'button',
          class: 'act setup-action setup-action-secondary',
          'data-testid': 'setup-opponents',
          onclick: () => { g.sfx('tap'); go(2); },
        }, h('span', { class: 'setup-action-title' }, 'Choose opponents'),
        h('span', { class: 'setup-action-sub' }, 'Name each AI & set difficulty')));
    };

    const paintAis = () => {
      const cards = draft.ais.map((ai, i) => {
        const nameInp = h('input', {
          class: 'setup-ai-name',
          type: 'text',
          maxlength: 20,
          'data-testid': `setup-ai-${i}-name`,
          value: ai.name,
        });
        nameInp.oninput = () => { ai.name = nameInp.value.trim() || DEFAULT_AIS[i]; };
        const pick = (lvl) => {
          ai.level = lvl;
          go(2);
        };
        return h('div', { class: 'setup-ai-card', 'data-testid': `setup-ai-card-${i}` },
          h('div', { class: 'setup-ai-head' }, h('span', { class: 'setup-ai-emoji' }, '🦎'), h('label', {}, `AI seat ${i + 1}`)),
          nameInp,
          levelPicker(g, i, ai.level, pick));
      });
      appendNodes(body,
        h('p', { class: 'setup-lead' }, 'Name each opponent and set difficulty.'),
        h('div', { class: 'setup-ai-list' }, cards),
        h('button', {
          type: 'button',
          class: 'act setup-action setup-action-primary',
          'data-testid': 'setup-start',
          onclick: () => {
            g.sfx('tap');
            const cfg = {
              human_name: draft.human_name.trim() || 'Keith',
              player_count: draft.player_count,
              ais: draft.ais.map((a, i) => ({
                name: (a.name || DEFAULT_AIS[i]).trim() || DEFAULT_AIS[i],
                level: ['easy', 'normal', 'hard'].includes(a.level) ? a.level : 'normal',
              })),
            };
            if (cfg.ais.some((a) => a.name === cfg.human_name)) {
              g.toast('Each AI name must differ from yours.');
              return;
            }
            Store.saveSetup(cfg);
            finish(cfg);
          },
        }, h('span', { class: 'setup-action-title' }, 'Pick reagents'),
        h('span', { class: 'setup-action-sub' }, `${draft.player_count} wizards at the table`)));
    };

    appendNodes(ov.el,
      closeBtn(() => { ov.close(); resolve(null); }, 'setup-cancel'),
      h('div', { class: 'ov-title', 'data-testid': 'setup-title' }, titles[0]),
      steps,
      body);
    go(0);
  });
}
