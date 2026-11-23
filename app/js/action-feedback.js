import { h } from './dom.js';
import * as GA from './gather-anim.js';

const SCHOOL_CLASS = {
  Alchemy: 'alchemy',
  Conjuring: 'conjuring',
  Druidry: 'druidry',
  Enchantment: 'enchantment',
  Necromancy: 'necromancy',
  Sorcery: 'sorcery',
  Thaumaturgy: 'thaumaturgy',
};

export const schoolClass = (school) => SCHOOL_CLASS[school] || (school ? String(school).toLowerCase() : '');

const SUMMON_PULSE_MS = 600;
const SCORE_BLINK_MS = 400;
const SCORE_GOLD_MS = 800;

function humanMatRoots() {
  return [...document.querySelectorAll('#peek-layer .mat.you, #overlays .mat.you')];
}

/** Summon chooser: one school-colored pulse on the enlarged card, then reveal the action tiles. */
export function runSummonIntroPulse(overlayEl, school) {
  if (!overlayEl || !school || GA.reducedMotion()) return Promise.resolve();
  const slug = schoolClass(school);
  const frame = overlayEl.querySelector('.big-frame[data-testid="expanded-card"]');
  if (!frame) return Promise.resolve();
  const pending = overlayEl.querySelectorAll('.summon-pulse-pending');
  overlayEl.dataset.summonPulse = 'active';
  frame.classList.add('summon-pulse', `summon-pulse-${slug}`);
  return new Promise((resolve) => {
    const finish = () => {
      frame.classList.remove('summon-pulse', `summon-pulse-${slug}`);
      pending.forEach((el) => el.classList.remove('summon-pulse-pending'));
      delete overlayEl.dataset.summonPulse;
      resolve();
    };
    let settled = false;
    const done = () => { if (settled) return; settled = true; finish(); };
    frame.addEventListener('animationend', (e) => {
      if (e.target === frame && e.animationName === 'summon-pulse-ring') done();
    }, { once: true });
    setTimeout(done, SUMMON_PULSE_MS + 80);
  });
}

/** Score with a familiar: blink matching inventory cards (not hand reagents) and float +N gold to the dock. */
export function runScoreFamiliarFeedback(g, { school, gold }) {
  if (GA.reducedMotion() || !school || !gold || gold <= 0) return;
  if (!g.v?.players?.some((p) => p.you)) return;

  const slug = schoolClass(school);
  const roots = humanMatRoots();
  const cards = [];
  roots.forEach((root) => {
    root.querySelectorAll('.mat-row:not(.mat-hand) .mcard[data-card-school]').forEach((el) => {
      if (el.dataset.cardSchool === school) cards.push(el);
    });
  });
  cards.forEach((el) => {
    el.classList.add('score-school-blink', `score-school-${slug}`);
    setTimeout(() => el.classList.remove('score-school-blink', `score-school-${slug}`), SCORE_BLINK_MS + 40);
  });

  const goldChip = document.querySelector('#dock [data-testid="my-gold"]');
  if (!goldChip) return;
  goldChip.classList.add('score-gold-chip-pulse');
  setTimeout(() => goldChip.classList.remove('score-gold-chip-pulse'), SCORE_GOLD_MS + 40);

  const start = cards[0]?.getBoundingClientRect() || goldChip.getBoundingClientRect();
  const end = goldChip.getBoundingClientRect();
  const floatEl = h('div', {
    class: `score-gold-float score-school-${slug}`,
    'data-testid': 'score-gold-float',
    'data-gold-delta': String(gold),
  }, h('span', { class: 'score-gold-float-label' }, `+${gold} gold`));
  floatEl.style.left = `${start.left + start.width / 2}px`;
  floatEl.style.top = `${start.top + start.height / 2}px`;
  floatEl.style.setProperty('--score-gold-dx', `${end.left + end.width / 2 - (start.left + start.width / 2)}px`);
  floatEl.style.setProperty('--score-gold-dy', `${end.top + end.height / 2 - (start.top + start.height / 2)}px`);
  document.body.appendChild(floatEl);
  const remove = () => floatEl.remove();
  floatEl.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, SCORE_GOLD_MS + 120);

  if (window.lwDebug) {
    window.lwDebug.lastScoreFeedback = { school, gold, cards: cards.length };
  }
}

export function hookDebug(g) {
  if (!window.lwDebug) return;
  window.lwDebug.runScoreFamiliarFeedback = (school, gold) => runScoreFamiliarFeedback(g, { school, gold });
}