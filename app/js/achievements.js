import { h, art, reagentIcon } from './dom.js';

const SAMPLE_ART = {
  Wizards: 'art/icons/achievement-wizard.webp',
  Towers: 'art/icons/achievement-tower.webp',
  Familiars: 'art/icons/achievement-familiar.webp',
};

const SPELL_SCROLL_ICON = `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <path d="M27 27c-5 2-8 7-7 13l5 31c1 7 7 11 14 10l36-6c5-1 8-5 7-10l-5-31c-1-6-6-9-12-8z" fill="#f5e4ad" stroke="#d6b45a" stroke-width="3"/>
  <path d="M27 27c-7-3-13 2-12 9l2 8c1 5 6 8 11 6l8-3-2-15z" fill="#fff0bd" stroke="#d6b45a" stroke-width="3"/>
  <path d="M73 20c7-2 13 2 14 8l2 8c1 5-3 9-8 10l-8 1-3-15z" fill="#fff0bd" stroke="#d6b45a" stroke-width="3"/>
  <path d="M35 43l36-6M36 54l38-6M38 65l26-4" fill="none" stroke="#896324" stroke-width="3" stroke-linecap="round" opacity=".8"/>
  <path d="M24 76c2 5 7 8 13 7l35-6c5-1 9 2 10 7" fill="none" stroke="#a77a2a" stroke-width="2"/>
</svg>`;

function shortBoardLabel(card = {}) {
  const l = card.tile_label || card.name || '';
  if (l.endsWith(' Cards')) return l.slice(0, -6);
  return l;
}

export function achievementIcon(card = {}) {
  const kind = card.tile_icon;
  if (kind === 'Gold') return h('span', { class: 'ach-tile-orb gold', 'aria-label': 'Gold' });
  if (kind === 'Mana') return h('span', { class: 'ach-tile-orb mana', 'aria-label': 'Mana' });
  if (kind === 'School' && card.school) {
    // The UI school crests are the largest clean source (256px), intended for display.
    return h('img', { src: `art/icons/schools_ui/school_${card.school}.png`, alt: '', class: 'ach-tile-img' });
  }
  if (kind === 'Reagent') {
    const r = card.school_reagent || String(card.tile_label || '').replaceAll(' ', '_');
    if (r) return h('img', { src: reagentIcon(r), alt: '', class: 'ach-tile-img' });
  }
  if (kind === 'Spells') return h('span', { class: 'ach-tile-svg', 'aria-label': 'Spells', html: SPELL_SCROLL_ICON });
  const sample = SAMPLE_ART[kind];
  if (sample) return h('img', { src: sample, alt: '', class: 'ach-tile-img ach-tile-deck' });
  return h('span', { class: 'ach-tile-orb gold', 'aria-hidden': 'true' });
}

/** One achievement face: board column (compact row), zoom (portrait), mat chips. */
export function achievementTile(card = {}, { size = 'board' } = {}) {
  const vp = card.vp ?? 10;
  const count = card.tile_count ?? '';
  const label = size === 'board' || size === 'chip' ? shortBoardLabel(card) : (card.tile_label || card.name || '');
  const body = h('div', { class: 'ach-tile-body' },
    h('div', { class: 'ach-tile-icon' }, h('div', { class: 'ach-tile-medallion' }, achievementIcon(card))),
    h('div', { class: 'ach-tile-text' },
      h('div', { class: 'ach-tile-count' }, count),
      label ? h('div', { class: 'ach-tile-label' }, label) : null));
  return h('div', { class: `ach-tile ach-tile-${size}`, 'data-testid': 'achievement-tile' },
    size === 'zoom' ? h('div', { class: 'ach-tile-h' }, 'ACHIEVEMENT') : null,
    h('div', { class: 'ach-tile-vp' }, String(vp)),
    body);
}

export function achievementBadge(card = {}) {
  return h('span', { class: 'ach-badge', 'data-testid': 'achievement-badge' }, achievementIcon(card));
}

export function achievementTitle(card = {}) {
  return card.title || card.display || card.name || '';
}

export function achievementFromText(cards, achText) {
  return cards[`Achievement:${achText}`] || {};
}
