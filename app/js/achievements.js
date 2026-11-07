import { h, art, reagentIcon, schoolIcon } from './dom.js';

const SAMPLE_ART = {
  Wizards: 'Wizard_Anguis_Magicus',
  Towers: 'Tower_T1_Azure_Tower',
  Familiars: 'Familiar_10_Imp',
  Spells: 'Spell_Scribe',
};

function shortBoardLabel(card = {}) {
  const l = card.tile_label || card.name || '';
  if (l.endsWith(' Cards')) return l.slice(0, -6);
  return l;
}

export function achievementIcon(card = {}) {
  const kind = card.tile_icon;
  if (kind === 'Gold') return h('span', { class: 'ach-tile-orb gold', 'aria-hidden': 'true' });
  if (kind === 'Mana') return h('span', { class: 'ach-tile-orb mana', 'aria-hidden': 'true' });
  if (kind === 'School' && card.school) return h('img', { src: schoolIcon(card.school), alt: '', class: 'ach-tile-img' });
  if (kind === 'Reagent') {
    const r = card.school_reagent || String(card.tile_label || '').replaceAll(' ', '_');
    if (r) return h('img', { src: reagentIcon(r), alt: '', class: 'ach-tile-img' });
  }
  const sample = SAMPLE_ART[kind];
  if (sample) return h('img', { src: art(sample), alt: '', class: 'ach-tile-img ach-tile-deck' });
  return h('span', { class: 'ach-tile-orb gold', 'aria-hidden': 'true' });
}

/** One achievement face: board column (compact row), zoom (portrait), mat chips. */
export function achievementTile(card = {}, { size = 'board' } = {}) {
  const vp = card.vp ?? 10;
  const count = card.tile_count ?? '';
  const label = size === 'board' || size === 'chip' ? shortBoardLabel(card) : (card.tile_label || card.name || '');
  const body = h('div', { class: 'ach-tile-body' },
    h('div', { class: 'ach-tile-icon' }, achievementIcon(card)),
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
