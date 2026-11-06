export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Like Element.append but skips null/undefined/false (native append stringifies those as "null"). */
export function appendNodes(parent, ...nodes) {
  for (const x of nodes.flat(Infinity)) {
    if (x === null || x === undefined || x === false) continue;
    parent.appendChild(x instanceof Node ? x : document.createTextNode(String(x)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const art = (key) => `art/cards/${key}.webp`;
export const reagentIcon = (r) => `art/icons/reagents/${String(r).replaceAll(' ', '_')}.png`;
export const schoolIcon = (sc) => `art/icons/schools/${sc}.png`;
export const nice = (r) => String(r ?? '').replaceAll('_', ' ');
export const REAGENTS = ['Mandrake', 'Eye_of_Newt', 'Nightshade', 'Sulphur', 'Foxglove', 'Toadstool', 'Horn'];
export const SCHOOL_REAGENT = { Conjuring: 'Horn', Sorcery: 'Foxglove', Alchemy: 'Eye_of_Newt', Enchantment: 'Mandrake', Druidry: 'Toadstool', Thaumaturgy: 'Sulphur', Necromancy: 'Nightshade' };

export function counts(list) {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

export function avatar(name, size = 34) {
  const cls = ['Keith', 'Newt', 'LizWiz'].includes(name) ? `av-${name}` : 'av-other';
  return h('div', { class: `avatar ${cls}`, style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.44)}px` } }, (name || '?')[0]);
}

export function tokenChip(r, n, extra = {}) {
  return h('span', { class: 'tok', ...extra }, h('img', { src: reagentIcon(r), alt: nice(r) }), n > 1 ? `×${n}` : '');
}

export function costIcons(list) {
  return list.map((r) => h('img', { src: reagentIcon(r), alt: nice(r), title: nice(r) }));
}
