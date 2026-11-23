import { h } from './dom.js';
import * as GA from './gather-anim.js';
import { schoolGlowTable } from './school-glow-colors.js';

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

function humanInventoryMat() {
  return document.querySelector('#peek-layer .inventory .mat.you');
}

function pulseFrame(overlayEl, cardIndex) {
  const idx = Number(cardIndex);
  if (!Number.isFinite(idx)) return null;
  return overlayEl.querySelector(`.big-frame[data-testid="expanded-card"][data-index="${idx}"]`)
    || overlayEl.querySelector(`.big-frame[data-testid="expanded-card"][data-index="${String(idx)}"]`);
}

let activeSummonPulse = null;

/** Stop an in-flight summon pulse (e.g. carousel swipe mid-animation) and clear all ring classes. */
export function cancelSummonIntroPulse(overlayEl) {
  if (!overlayEl) return;
  if (activeSummonPulse?.overlayEl === overlayEl) {
    activeSummonPulse.finish();
    activeSummonPulse = null;
    return;
  }
  overlayEl.querySelectorAll('.big-frame.summon-pulse').forEach((frame) => {
    frame.classList.forEach((cls) => {
      if (cls.startsWith('summon-pulse-') && cls !== 'summon-pulse') frame.classList.remove(cls);
    });
    frame.classList.remove('summon-pulse');
  });
  overlayEl.classList.remove('summon-pulse-stage');
  overlayEl.querySelectorAll('.summon-pulse-pending').forEach((el) => el.classList.remove('summon-pulse-pending'));
  delete overlayEl.dataset.summonPulse;
}

/** Summon chooser: one school-colored pulse on the enlarged card, then reveal the action tiles. */
export function runSummonIntroPulse(overlayEl, school, cardIndex) {
  if (!overlayEl || !school || GA.reducedMotion()) return Promise.resolve();
  cancelSummonIntroPulse(overlayEl);
  const slug = schoolClass(school);
  const frame = pulseFrame(overlayEl, cardIndex);
  if (!frame) return Promise.resolve();
  const pending = overlayEl.querySelectorAll('.summon-pulse-pending');
  overlayEl.dataset.summonPulse = 'active';
  frame.classList.add('summon-pulse', `summon-pulse-${slug}`);
  overlayEl.classList.add('summon-pulse-stage');
  return new Promise((resolve) => {
    const finish = () => {
      frame.classList.remove('summon-pulse', `summon-pulse-${slug}`);
      overlayEl.classList.remove('summon-pulse-stage');
      pending.forEach((el) => el.classList.remove('summon-pulse-pending'));
      delete overlayEl.dataset.summonPulse;
      if (activeSummonPulse?.finish === finish) activeSummonPulse = null;
      resolve();
    };
    activeSummonPulse = { overlayEl, finish };
    let settled = false;
    const done = () => { if (settled) return; settled = true; finish(); };
    frame.addEventListener('animationend', (e) => {
      if (e.target === frame && e.animationName === 'summon-pulse-ring') done();
    }, { once: true });
    setTimeout(done, SUMMON_PULSE_MS + 80);
  });
}

function placeGoldFloat(host, chip, gold, slug) {
  if (!host || !chip) return null;
  const floatEl = h('div', {
    class: `score-gold-float score-school-${slug}`,
    'data-testid': 'score-gold-float',
    'data-gold-delta': String(gold),
  }, h('span', { class: 'score-gold-float-label' }, `+${gold} gold`));
  const hostRect = host.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  floatEl.style.left = `${chipRect.left - hostRect.left + chipRect.width / 2}px`;
  floatEl.style.top = `${chipRect.top - hostRect.top}px`;
  host.classList.add('score-gold-float-host');
  host.appendChild(floatEl);
  const remove = () => {
    floatEl.remove();
    host.classList.remove('score-gold-float-host');
  };
  floatEl.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, SCORE_GOLD_MS + 120);
  return floatEl;
}

/** Score with a familiar: blink matching cards in the human inventory mat and float +N gold up from their gold chip. */
export function runScoreFamiliarFeedback(g, { school, gold, fromHuman = false }) {
  if (GA.reducedMotion() || !school || !gold || gold <= 0 || !fromHuman) return;
  if (!g.v?.players?.some((p) => p.you)) return;

  const slug = schoolClass(school);
  const humanMat = humanInventoryMat();
  const cards = [];
  if (humanMat) {
    humanMat.querySelectorAll('.mat-row:not(.mat-hand) .mcard[data-card-school]').forEach((el) => {
      if (el.dataset.cardSchool === school) cards.push(el);
    });
  }
  cards.forEach((el) => {
    el.classList.add('score-school-blink', `score-school-${slug}`);
    setTimeout(() => el.classList.remove('score-school-blink', `score-school-${slug}`), SCORE_BLINK_MS + 40);
  });

  let goldChip = null;
  let floatHost = null;
  if (humanMat) {
    goldChip = humanMat.querySelector('[data-testid="inv-my-gold"]');
    floatHost = humanMat;
  } else {
    goldChip = document.querySelector('#dock [data-testid="my-gold"]');
    floatHost = document.getElementById('dock');
  }
  if (!goldChip || !floatHost) return;

  goldChip.classList.add('score-gold-chip-pulse');
  setTimeout(() => goldChip.classList.remove('score-gold-chip-pulse'), SCORE_GOLD_MS + 40);

  placeGoldFloat(floatHost, goldChip, gold, slug);

  if (window.lwDebug) {
    window.lwDebug.lastScoreFeedback = { school, gold, cards: cards.length, humanOnly: true };
  }
}

export function hookDebug(g) {
  if (!window.lwDebug) return;
  window.lwDebug.runScoreFamiliarFeedback = (school, gold) => runScoreFamiliarFeedback(g, { school, gold, fromHuman: true });
  window.lwDebug.tryScoreFamiliarFeedbackAI = (school, gold) => runScoreFamiliarFeedback(g, { school, gold, fromHuman: false });
  window.lwDebug.schoolGlowColors = schoolGlowTable();
}