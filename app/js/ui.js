import { h, art, reagentIcon, schoolIcon, nice, REAGENTS, counts, avatar, tokenChip, costIcons, sleep, appendNodes, replaceChildren } from './dom.js';
import { versionLabel } from './version.js';
import * as Store from './store.js';
import { achievementTile, achievementBadge, achievementTitle, achievementFromText, SPELL_SCROLL_ICON } from './achievements.js';

const DIFF_LABELS = { easy: 'Apprentice', normal: 'Adept', hard: 'Archmage', master: 'Grand Sorcerer' };

function diffBadge(level) {
  if (!level) return null;
  return h('span', { class: `diff-badge ${level}`, 'data-testid': `diff-badge-${level}` }, DIFF_LABELS[level] || level);
}

// ------------------------------------------------------------------ overlay plumbing
export function openOverlay(cls, { onScrim = null, testid = null } = {}) {
  const root = document.getElementById('overlays');
  const el = h('div', { class: `overlay ${cls}`, 'data-testid': testid || `ov-${cls.split(' ')[0]}` });
  let closed = false;
  const ov = {
    el,
    close() {
      if (closed) return; closed = true;
      el.classList.add('out'); setTimeout(() => el.remove(), 180);
    },
    get closed() { return closed; },
  };
  if (onScrim) el.addEventListener('click', (e) => { if (e.target === el) onScrim(ov); });
  root.appendChild(el);
  scrollHint(el);
  return ov;
}

// "More below" pill whenever an overlay's content runs past the visible area; tapping it scrolls down.
function scrollHint(el) {
  const hint = h('button', { class: 'scroll-hint off', 'data-testid': 'scroll-hint', 'aria-label': 'More below', onclick: (e) => { e.stopPropagation(); el.scrollBy({ top: el.clientHeight * 0.7, behavior: 'smooth' }); } }, '⌄');
  document.getElementById('overlays').appendChild(hint);
  const update = () => {
    if (!el.isConnected || el.classList.contains('out')) { hint.remove(); mo.disconnect(); return; }
    const spacer = parseFloat(getComputedStyle(el, '::after').height) || 0;   // the bottom clearance is not content
    hint.classList.toggle('off', el.scrollTop > 40 || el.scrollTop + el.clientHeight >= el.scrollHeight - spacer - 24);
  };
  const mo = new MutationObserver(() => requestAnimationFrame(update));
  mo.observe(el, { childList: true, subtree: true });
  new MutationObserver(update).observe(document.getElementById('overlays'), { childList: true });
  el.addEventListener('scroll', update, { passive: true });
  el.addEventListener('load', update, true);
  el.addEventListener('animationend', update, true);           // entrance animations inflate scrollHeight while they run
  el.addEventListener('transitionend', update, true);
  window.addEventListener('resize', update);
  requestAnimationFrame(update);
}
export function closeAll() { document.querySelectorAll('#overlays .overlay').forEach((o) => o.remove()); }

/** Remove swipe/enlarge card overlays (not other flows). */
export function closeExpandOverlays() {
  document.querySelectorAll('[data-testid="expanded"]').forEach((el) => el.remove());
}

/** Close expand before settle/AI so the enlarge sheet does not sit above banners. */
export async function commitFromExpand(g, overlay, run) {
  const r = await run();
  if (!r) return;
  overlay.close();
  await g.afterAction();
  return true;
}

function closeBtn(fn, testid = 'ov-close') { return h('button', { class: 'ov-close', 'aria-label': 'Close', 'data-testid': testid, onclick: (e) => { e.stopPropagation(); fn(); } }, '×'); }
const wait = () => { let res; const p = new Promise((r) => { res = r; }); return [p, res]; };

// Card art flying from one place to another (auction win, loot to the mat, builds).
export function fly(src, from, toEl, { w = 54, hgt = 76 } = {}) {
  if (!from || !toEl) return Promise.resolve();
  const to = toEl.getBoundingClientRect();
  const img = h('img', { class: 'fly', src, alt: '', style: { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` } });
  appendNodes(document.body, img);
  requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(img.style, {
    left: `${to.left + to.width / 2 - w / 2}px`, top: `${to.top + to.height / 2 - hgt / 2}px`, width: `${w}px`, height: `${hgt}px`, opacity: '0.15', transform: 'rotate(-8deg)',
  })));
  return new Promise((resolve) => setTimeout(() => { img.remove(); resolve(); }, 820));
}
const dockTarget = () => document.querySelector('[data-testid=my-vp]');
const slotRectOf = (key) => { const el = document.querySelector(`#board [data-key="${key}"]`); return el ? el.getBoundingClientRect() : null; };

// ------------------------------------------------------------------ card text (carddb only)
export function cardInfo(g, key) {
  const c = g.cards[key] || {};
  const meta = [];
  if (c.deck === 'Achievement') {
    meta.push(h('span', {}, `${c.vp ?? 10} VP when claimed`), achievementBadge(c));
  } else if (c.school) meta.push(logSchoolChip(c.school));
  if (c.deck === 'Spell') {
    meta.push(h('span', {}, c.duration === '1x' ? 'One-time (1x)' : 'Ongoing'));
    const rg = Object.entries(c.cost?.reagents || {});
    const spellCost = rg.flatMap(([r, n]) => n === 'X' ? [r] : Array.from({ length: n }, () => r));
    meta.push(h('span', { class: 'card-cost-row' },
      logValueChip({ kind: 'mana', value: c.cost?.mana ?? 5 }),
      h('span', { class: 'card-cost-reagents' }, ...groupReagents(spellCost).map(({ reagent: r, count }) => logReagentChip(r, { count })))));
  } else if (c.deck === 'Tower') {
    meta.push(h('span', {}, `Tier ${c.cost?.tier}`), h('span', {}, `Cost ${c.cost?.reagent_count} `, h('img', { src: reagentIcon(c.cost?.reagent), alt: '' }), ` or ${c.cost?.gold} Gold`));
  } else if (c.deck === 'Familiar') {
    meta.push(h('span', {}, `${c.cost?.mana} mana`));
  }
  let text;
  if (c.deck === 'Achievement') text = c.effect || '';
  else if (c.deck === 'Familiar' && c.effect) text = c.effect.split('||').map((part) => {
    const line = part.trim().replace(' | ', ' · ');
    const collect = line.match(/^(.*?Collect)\s+(\d+)\s+([A-Za-z_]+)(.*)$/);
    if (collect) {
      const reagent = collect[3];
      return h('div', {}, `${collect[1]} `, logReagentChip(reagent, { count: Number(collect[2]) }), collect[4]);
    }
    const dungeon = line.match(/^(.*?)(\d+)\s+Gold\s+\/\s+([A-Za-z-]+)\s+Card(.*)$/);
    if (dungeon) {
      return h('div', {}, dungeon[1], logValueChip({ kind: 'gold', value: Number(dungeon[2]) }), ' / ',
        logSchoolChip(dungeon[3]), ' card', dungeon[4]);
    }
    return h('div', {}, line);
  });
  else if (c.deck === 'Reagent') text = [h('div', {}, 'Gather: ', ...costIcons(c.gather_icons || [])), h('div', {}, 'Increase Value: ', ...costIcons(c.increase_icons || []))];
  else text = c.effect || '';
  return h('div', { class: 'cardinfo', 'data-testid': 'card-info' },
    h('div', { class: 'ci-name' }, c.deck === 'Achievement' ? achievementTitle(c) : (c.display || c.name || key)),
    meta.length ? h('div', { class: 'ci-meta' }, meta) : null,
    text ? h('div', { class: 'ci-text', 'data-testid': 'card-text' }, text) : null);
}

const TIME_SHIFT_DECK_LABEL = { wizards: 'Wizards', towers: 'Towers', familiars: 'Familiars', spells: 'Spells' };

// Shared horizontal carousel gesture. Pointer Events are primary on iOS; the
// touch fallback also supports element-dispatched WebKit TouchEvents.
export function attachSwipe(el, { onBegin = null, onDrag = null, onSwipe, onCancel = null, threshold = 50 } = {}) {
  let startX = 0; let startY = 0; let currentX = 0; let currentY = 0;
  let active = false; let moved = false; let horizontal = false; let touchId = null;
  let pointerId = null; let touchActive = false;
  // iOS WebKit can emit PointerEvents and TouchEvents for the same finger. On
  // touch-capable devices use the non-passive TouchEvent path so horizontal
  // intent can call preventDefault before the sheet starts scrolling. Keep
  // PointerEvents for mouse/pen input on desktop.
  const touchPrimary = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const start = (x, y) => {
    if (onBegin?.(x, y) === false) return false;
    startX = x; startY = y; currentX = x; currentY = y;
    active = true; moved = false; horizontal = false; return true;
  };
  const move = (x, y, e = null) => {
    if (!active) return;
    const dx = x - startX; const dy = y - startY;
    if (!horizontal && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) horizontal = true;
    if (horizontal && e?.cancelable) e.preventDefault();
    if (!moved && !horizontal && Math.abs(dy) > 10) { active = false; onCancel?.(); return; }
    moved = true; currentX = x; currentY = y; onDrag?.(dx, dy);
  };
  const end = (cancelled = false) => {
    if (!active) return;
    active = false;
    const dx = currentX - startX; const dy = Math.abs(currentY - startY);
    if ((cancelled && horizontal && Math.abs(dx) > threshold) || (!cancelled && moved && Math.abs(dx) > threshold && Math.abs(dx) > dy)) onSwipe?.(dx);
    else onCancel?.();
    touchId = null; pointerId = null;
  };
  const point = (list) => [...list].find((t) => touchId === null || t.identifier === touchId);
  if (!touchPrimary) {
    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || touchActive || !start(e.clientX, e.clientY)) return;
      pointerId = e.pointerId; el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === pointerId) move(e.clientX, e.clientY, e); });
    el.addEventListener('pointerup', (e) => { if (e.pointerId === pointerId) end(); });
    el.addEventListener('pointercancel', (e) => { if (e.pointerId === pointerId) end(true); });
  }
  el.addEventListener('touchstart', (e) => {
    if (pointerId !== null || active) return;
    const t = e.changedTouches[0]; if (!t || !start(t.clientX, t.clientY)) return;
    touchId = t.identifier; touchActive = true;
  }, { passive: false });
  el.addEventListener('touchmove', (e) => {
    const t = point(e.touches); if (t) move(t.clientX, t.clientY, e);
  }, { passive: false });
  el.addEventListener('touchend', (e) => {
    const t = point(e.changedTouches); if (t) { currentX = t.clientX; currentY = t.clientY; end(); touchActive = false; }
  }, { passive: false });
  el.addEventListener('touchcancel', () => { end(true); touchActive = false; }, { passive: false });
  el.addEventListener('mousedown', (e) => { if (!touchPrimary && !('PointerEvent' in window)) { start(e.clientX, e.clientY); e.preventDefault(); } });
  el.addEventListener('mousemove', (e) => { if (!touchPrimary && !('PointerEvent' in window) && active) { move(e.clientX, e.clientY, e); } });
  el.addEventListener('mouseup', () => { if (!touchPrimary && !('PointerEvent' in window)) end(); });
}

export function expandCard(g, key, {
  actions = [], extra = null, group = null, groupIndex = 0, title = null, titleTestid = null,
  subtitle = null, actionPrompt = null, actionLayout = 'actions', compactTiles = false, costInfo = null,
  testid = 'expanded', closeTestid = 'ov-close',
} = {}) {
  // group: array of card keys for swipeable navigation, groupIndex: current card index in group
  const cards = (group && group.length ? group : [key]).filter(Boolean);
  const resolvedIdx = Number.isFinite(groupIndex) && groupIndex >= 0 ? groupIndex : cards.indexOf(key);
  let currentIndex = Math.min(Math.max(0, resolvedIdx < 0 ? 0 : resolvedIdx), cards.length - 1);
  
  const ov = openOverlay('expand', { onScrim: (o) => o.close(), testid });
  if (actionLayout === 'tiles') ov.el.classList.add('tiles');
  
  // Container for all card frames (for swipe animation)
  const cardTrack = h('div', { class: 'card-track', 'data-testid': 'card-track' });
  const cardinfoContainer = h('div', { class: 'cardinfo-container', 'data-testid': 'cardinfo-container' });
  const actionsContainer = h('div', { class: `actions-container ${actionLayout === 'tiles' ? 'familiar-action-grid' : ''}`, 'data-testid': 'expanded-actions' });
  const costContainer = h('div', { class: 'familiar-summon-cost', 'data-testid': 'summon-cost' });
  const scrollInner = h('div', { class: 'expand-inner', 'data-testid': 'expand-inner' });
  
  // Position indicator (dots or "2 / 4")
  const indicator = cards.length > 1 ? h('div', { class: 'card-indicator', 'data-testid': 'card-indicator' }, 
    cards.length <= 5 
      ? cards.map((_, i) => h('span', { class: i === currentIndex ? 'dot active' : 'dot', 'data-index': i }))
      : h('span', { class: 'counter' }, `${currentIndex + 1} / ${cards.length}`)
  ) : null;
  
  // Arrow buttons for desktop (only if multiple cards)
  const prevBtn = cards.length > 1 ? h('button', { 
    class: 'nav-arrow prev', 
    'aria-label': 'Previous card', 
    'data-testid': 'nav-prev',
    onclick: (e) => { e.stopPropagation(); if (currentIndex > 0) navigateTo(currentIndex - 1); }
  }, '‹') : null;
  
  const nextBtn = cards.length > 1 ? h('button', { 
    class: 'nav-arrow next', 
    'aria-label': 'Next card', 
    'data-testid': 'nav-next',
    onclick: (e) => { e.stopPropagation(); if (currentIndex < cards.length - 1) navigateTo(currentIndex + 1); }
  }, '›') : null;
  
  function renderCard(idx) {
    const k = cards[idx];
    const isAch = k.startsWith('Achievement:');
    if (isAch) {
      return h('div', {
        class: 'big-frame big-frame-ach',
        'data-testid': 'expanded-card',
        'data-index': idx,
      }, achievementTile(g.cards[k] || {}, { size: 'zoom' }));
    }
    return h('div', {
      class: 'big-frame',
      'data-testid': 'expanded-card',
      'data-index': idx,
    }, h('img', { class: 'big', src: art(k), alt: k, draggable: 'false', 'data-testid': 'expanded-img' }));
  }
  
  function updateContent(idx, animate = true) {
    const k = cards[idx];
    
    // Update card track
    cardTrack.innerHTML = '';
    // Render current card and neighbors for smooth transitions
    const start = Math.max(0, idx - 1);
    const end = Math.min(cards.length, idx + 2);
    for (let i = start; i < end; i++) {
      const frame = renderCard(i);
      if (frame) {
        frame.style.transform = `translateX(${(i - idx) * 100}%)`;
        frame.style.transition = animate ? 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)' : 'none';
        cardTrack.appendChild(frame);
      }
    }
    
    // Update info
    // Reagent cards are visual reference cards rather than action/info panels.
    // Keep the shared expand carousel (track, dots, arrows and swipe) but omit
    // the legacy Gather/Increase Value panel so the card remains centered on
    // short phone viewports. Other card decks retain their existing details.
    const isReagent = g.cards[k]?.deck === 'Reagent';
    cardinfoContainer.hidden = isReagent;
    replaceChildren(cardinfoContainer, isReagent ? null : cardInfo(g, k));
    if (actionLayout === 'tiles' && costInfo) {
      const info = typeof costInfo === 'function' ? costInfo(k, idx) : costInfo;
      if (info) {
        const remaining = Number(info.remaining);
        replaceChildren(costContainer,
          h('span', { class: 'familiar-summon-mana', 'aria-hidden': 'true' }, logValueChip({ kind: 'mana', value: info.cost })),
          h('span', { class: 'familiar-summon-cost-copy' },
            h('span', { class: 'familiar-summon-cost-title' }, 'Summon for ', logValueChip({ kind: 'mana', value: info.cost })),
            h('span', { class: `familiar-summon-cost-detail ${info.affordable ? '' : 'unaffordable'}` },
              info.affordable
                ? ['You have ', logValueChip({ kind: 'mana', value: info.mana }), ' · ', logValueChip({ kind: 'mana', value: remaining }), ' left after']
                : ['You have ', logValueChip({ kind: 'mana', value: info.mana }), ' · not enough mana'])));
        costContainer.hidden = false;
      } else {
        costContainer.hidden = true;
      }
    }

    const actBtn = (a) => {
      const sub = a.sub == null ? null : (Array.isArray(a.sub) ? h('span', { class: 'sub' }, ...a.sub) : h('span', { class: 'sub' }, a.sub));
      if (actionLayout === 'tiles') {
        return h('button', {
          class: `familiar-action-tile ${a.disabled ? 'disabled' : ''}`, disabled: a.disabled || null, 'data-testid': a.testid,
          onclick: async (e) => { e.stopPropagation(); g.sfx(a.use === 'score' ? 'coin' : 'select'); const keep = await a.onClick(ov); if (!keep) ov.close(); },
        }, h('span', { class: 'familiar-action-icon' }, familiarActionIcon(a.use, a.reagent)),
        h('span', { class: 'familiar-action-copy' }, h('span', { class: 'familiar-action-title' }, a.label),
          h('span', { class: 'familiar-action-detail' }, a.detail ?? sub),
          a.note ? h('span', { class: 'familiar-action-note' }, a.note) : null));
      }
      return h('button', {
        class: `act ${a.cls || ''}`, disabled: a.disabled || null, 'data-testid': a.testid,
        onclick: async (e) => { e.stopPropagation(); g.sfx('tap'); const keep = await a.onClick(ov); if (!keep) ov.close(); },
      }, h('span', {}, a.label), sub);
    };

    // Update actions (function form refreshes per swipe target)
    const acts = typeof actions === 'function' ? actions(k, idx) : actions;
    replaceChildren(actionsContainer);
    if (acts?.length) {
      if (actionLayout === 'tiles') {
        replaceChildren(actionsContainer, ...acts.map(actBtn));
      } else {
        const row = h('div', { class: 'actions' });
        acts.forEach((a) => appendNodes(row, actBtn(a)));
        replaceChildren(actionsContainer, row);
      }
    }
    
    // Update indicator
    if (indicator) {
      if (cards.length <= 5) {
        indicator.querySelectorAll('.dot').forEach((dot, i) => {
          dot.classList.toggle('active', i === idx);
        });
      } else {
        indicator.querySelector('.counter').textContent = `${idx + 1} / ${cards.length}`;
      }
    }
    
    // Update arrow visibility
    if (prevBtn) prevBtn.style.opacity = idx > 0 ? '1' : '0.3';
    if (nextBtn) nextBtn.style.opacity = idx < cards.length - 1 ? '1' : '0.3';
  }
  
  function navigateTo(newIndex, animate = true) {
    if (newIndex < 0 || newIndex >= cards.length || newIndex === currentIndex) return;
    g.sfx('tap');
    currentIndex = newIndex;
    updateContent(currentIndex, animate);
  }
  
  // Swipe gesture handling
  if (cards.length > 1) {
    attachSwipe(cardTrack, {
      onDrag: (deltaX) => {
      const frames = cardTrack.querySelectorAll('.big-frame');
      const activeFrame = Array.from(frames).find(f => parseInt(f.dataset.index) === currentIndex);
      if (activeFrame) {
        let translateX = deltaX;
        if ((currentIndex === 0 && deltaX > 0) || (currentIndex === cards.length - 1 && deltaX < 0)) {
          translateX = deltaX * 0.3; // reduced movement at bounds
        }
        activeFrame.style.transition = 'none';
        activeFrame.style.transform = `translateX(${translateX}px)`;
      }
      },
      onSwipe: (deltaX) => {
        const next = deltaX > 0 ? currentIndex - 1 : currentIndex + 1;
        if (next < 0 || next >= cards.length) updateContent(currentIndex);
        else navigateTo(next);
      },
      onCancel: () => updateContent(currentIndex),
    });
    
    // Keyboard navigation
    const keyHandler = (e) => {
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        navigateTo(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < cards.length - 1) {
        e.preventDefault();
        navigateTo(currentIndex + 1);
      }
    };
    ov.el.addEventListener('keydown', keyHandler);
    ov.el.tabIndex = 0;
    ov.el.focus();
  }
  
  const titleEl = title ? h('div', { class: `ov-title ${actionLayout === 'tiles' ? 'phase-title' : ''}`, 'data-testid': titleTestid || 'expand-title' }, title) : null;
  const subtitleEl = subtitle ? h('div', { class: 'ov-sub familiar-action-subtitle' }, subtitle) : null;
  const promptEl = actionPrompt ? h('div', { class: 'familiar-action-pick' }, actionPrompt) : null;
  if (actionLayout === 'tiles') {
    appendNodes(scrollInner, cardTrack, indicator,
      compactTiles ? null : titleEl, compactTiles ? null : subtitleEl,
      costInfo ? costContainer : null, promptEl, actionsContainer);
  } else {
    appendNodes(scrollInner, titleEl, subtitleEl, cardTrack, indicator, promptEl, actionsContainer, cardinfoContainer);
  }
  appendNodes(ov.el, closeBtn(() => ov.close(), closeTestid), prevBtn, nextBtn, scrollInner);

  // Initial render
  updateContent(currentIndex, false);

  if (extra) appendNodes(ov.el, extra);
  
  return ov;
}

// ------------------------------------------------------------------ player mats overlay
function pairUp(g, wizards, towers) {
  const sc = (k) => g.cards[k]?.school;
  const usedT = new Set(); const cols = [];
  wizards.forEach((w) => {
    const j = towers.findIndex((t, i) => !usedT.has(i) && sc(t) && sc(t) === sc(w));
    if (j >= 0) { usedT.add(j); cols.push([w, towers[j], true]); } else cols.push([w, null, false]);
  });
  let free = towers.map((t, i) => i).filter((i) => !usedT.has(i));
  cols.forEach((c) => { if (!c[1] && free.length) { c[1] = towers[free.shift()]; } });
  free.forEach((i) => cols.push([null, towers[i], false]));
  return cols;
}

function mini(g, key, { cls = '', badge = null, testid = null, group = null, groupIndex = 0, handGather = false } = {}) {
  if (!key) return h('div', { class: 'mcard back', 'data-testid': testid }, 'LW');
  return h('div', { class: `mcard ${cls}`, 'data-testid': testid, onclick: (e) => { 
    e.stopPropagation(); 
    g.sfx('tap');
    const youTurn = g.v.next === g.me && !g.v.game_over;
    const legal = !!(g.v.legal.gather || {})[key];
    if (handGather && youTurn && legal && !g.busyFlow()) gatherFlow(g, key);
    else expandCard(g, key, { group, groupIndex });
  } },
    h('img', { src: art(key), alt: key }), badge ? h('div', { class: 'badge' }, badge) : null);
}

// "Anguis Magicus ×3, Draco Mortemus": the exact cards on a mat, so a screenshot shows what the engine holds.
function cardList(g, keys) {
  if (!keys.length) return 'none';
  const n = new Map(); keys.forEach((k) => n.set(k, (n.get(k) || 0) + 1));
  return [...n].map(([k, c]) => `${g.cards[k]?.name || k}${c > 1 ? ` ×${c}` : ''}`).join(', ');
}

export function openMats(g) {
  const ov = openOverlay('mats', { onScrim: (o) => o.close(), testid: 'mats' });
  appendNodes(ov.el, closeBtn(() => ov.close()));
  const v = g.v;
  const order = [...v.players].sort((a, b) => (b.you - a.you) || v.seat_order.indexOf(a.name) - v.seat_order.indexOf(b.name));
  console.info('[mats]', order.map((p) => `${p.name}: wizards [${p.wizards.join(', ')}] towers [${p.towers.join(', ')}]`).join(' | '));
  for (const p of order) {
    const tag = p.you ? 'You' : (p.human ? 'Human' : `AI${p.profile ? ' · ' + p.profile : ''}`);
    const tok = counts(p.tok);
    const pairs = pairUp(g, p.wizards, p.towers);
    appendNodes(ov.el, h('div', { class: `mat ${p.you ? 'you' : ''}`, 'data-testid': `mat-${p.name}` },
      h('div', { class: 'mat-head' }, avatar(p.name, 30), h('span', { class: 'mat-name' }, p.name), !p.you && p.level ? diffBadge(p.level) : null, h('span', { class: `mat-tag ${p.you ? 'you' : ''}` }, tag),
        h('span', { class: 'stat vp mat-vp' }, `${p.vp} VP`)),
      h('div', { class: 'mat-row' },
        h('span', { class: 'stat mana' }, h('span', { class: 'orb' }), p.mana === null ? '?' : p.mana),
        h('span', { class: 'stat gold' }, h('span', { class: 'orb' }), p.gold === null ? '?' : p.gold),
        h('span', { class: `stat store ${p.tok.length >= p.cap ? 'full' : ''}` }, `Reagents ${p.tok.length}/${p.cap}`),
        h('span', { class: 'stat store' }, `Gather 3${p.bonus.length ? ' +' + p.bonus.length : ''}`, ...p.bonus.map((r) => h('img', { src: reagentIcon(r), alt: '', style: { width: '18px' } })))),
      h('div', { class: 'mat-row' }, tok.size ? [...tok].map(([r, n]) => tokenChip(r, n)) : h('span', { class: 'none' }, 'No reagent tokens')),
      h('div', { class: 'mat-label' }, p.you ? 'Reagent cards in hand' : `Reagent cards in hand: ${p.hand_count}`),
      p.you ? h('div', { class: 'mat-row' }, p.hand.map((k, i) => mini(g, k, {
        group: p.hand, groupIndex: i, handGather: p.you && g.v.next === g.me && !g.v.game_over,
      }))) : null,
      h('div', { class: 'mat-label' }, `Wizards & Towers (${p.wizards.length}/${p.towers.length})`),
      h('div', { class: 'mat-row' }, pairs.length ? pairs.map(([w, t, m], i) => {
        // Create combined group of all wizards and towers for this mat
        const wizardsGroup = p.wizards.filter(k => k);
        const towersGroup = p.towers.filter(k => k);
        return h('div', { class: `pair ${m ? 'match' : ''}` },
          h('span', { class: 'pts' }, m ? '+10' : (w && t ? '+5' : '+1')), 
          w ? mini(g, w, { group: wizardsGroup, groupIndex: wizardsGroup.indexOf(w) }) : h('div', { class: 'mcard empty' }, 'no wizard'), 
          t ? mini(g, t, { group: towersGroup, groupIndex: towersGroup.indexOf(t) }) : h('div', { class: 'mcard empty' }, 'no tower'));
      }) : h('span', { class: 'none' }, 'None yet')),
      h('div', { class: 'mat-cardlist', 'data-testid': `mat-cards-${p.name}`, 'data-wizards': p.wizards.join(','), 'data-towers': p.towers.join(',') },
        `Wizards: ${cardList(g, p.wizards)} · Towers: ${cardList(g, p.towers)}`),
      h('div', { class: 'mat-label' }, `Spells & Familiars (${p.spells.length + p.familiars.length})`),
      h('div', { class: 'mat-row' }, (p.spells.length + p.familiars.length) ? (() => {
        // Create combined group of all spells and familiars
        const spellsAndFams = [...p.spells.filter(s => s.key).map(s => s.key), ...p.familiars.filter(f => f)];
        return [
          ...p.spells.map((s, i) => s.key ? mini(g, s.key, { 
            cls: s.cast ? '' : 'uncast', 
            badge: s.cast ? null : 'uncast',
            group: spellsAndFams,
            groupIndex: spellsAndFams.indexOf(s.key)
          }) : mini(g, null)),
          ...p.familiars.map((f, i) => mini(g, f, {
            group: spellsAndFams,
            groupIndex: spellsAndFams.indexOf(f)
          })),
        ];
      })() : h('span', { class: 'none' }, 'None yet')),
      (p.treasures.length || p.achievements.length) ? h('div', { class: 'mat-label' }, 'Items & Achievements') : null,
      (p.treasures.length || p.achievements.length) ? h('div', { class: 'mat-row' },
        ...p.treasures.map((t) => mini(g, t.key)), ...p.achievements.map((a) => h('span', { class: 'ach-chip' }, achievementTile(achievementFromText(g.cards, a), { size: 'chip' })))) : null,
    ));
  }
  return ov;
}

// ------------------------------------------------------------------ log drawer
const DOT = { Keith: '#6ff0d0', Newt: '#c49bff', LizWiz: '#ffb46b' };

export function logReagentChip(r, { bonus = false, count = 1, track = null } = {}) {
  const label = nice(r);
  const suffix = track ? `▲+${track}` : (count >= 2 ? `×${count}` : '');
  return h('span', {
    class: `log-reagent-chip ${track ? 'log-track-chip' : ''}`,
    title: suffix ? `${label} ${suffix}` : label,
    'aria-label': suffix ? `${label} ${suffix}` : label,
  }, h('img', { src: reagentIcon(r), alt: label }),
    suffix ? h('span', { class: 'log-reagent-count' }, suffix) : null);
}

export function groupReagents(reagents = [], bonus = []) {
  reagents = Array.isArray(reagents) ? reagents : [];
  bonus = Array.isArray(bonus) ? bonus : [];
  const grouped = new Map();
  const bonusSet = new Set(bonus);
  for (const reagent of [...reagents, ...bonus]) grouped.set(reagent, (grouped.get(reagent) || 0) + 1);
  return [...grouped.entries()].map(([reagent, count]) => ({ reagent, count, bonus: bonusSet.has(reagent) }));
}

function logReagentRow(reagents, bonus = []) {
  return h('div', { class: 'log-reagent-row' },
    ...groupReagents(reagents, bonus).map(({ reagent: r, count, bonus: isBonus }) => logReagentChip(r, { bonus: isBonus, count })));
}

function logTracksRow(tracks) {
  const countsByReagent = new Map();
  (tracks || []).forEach((r) => countsByReagent.set(r, (countsByReagent.get(r) || 0) + 1));
  return h('div', { class: 'log-track-row' },
    h('span', { class: 'log-track-label' }, 'TRACKS UP'),
    h('div', { class: 'log-reagent-row' },
      ...countsByReagent.keys().map((r) => logReagentChip(r, { track: countsByReagent.get(r), count: countsByReagent.get(r) }))));
}

function logSchoolChip(school, tier = null) {
  const label = tier ? `T${tier} ${school}` : school;
  const crest = ['Wild', 'Arch-Mage'].includes(school) ? null : h('img', { src: schoolIcon(school), alt: school });
  return h('span', { class: `log-school-chip ${crest ? '' : 'plain'}`, title: label, 'aria-label': label }, crest, label);
}

export function logValueChip({ kind, value }) {
  const label = `${value} ${kind}`;
  return h('span', { class: `log-value-chip ${kind}`, title: label, 'aria-label': label },
    h('span', { class: 'log-value-number' }, String(Math.abs(value))),
    h('span', { class: `log-value-orb ${kind}`, 'aria-hidden': 'true' }));
}

function logInlineReagents(text, reagents, bonus = [], school = null, tier = null, values = [], options = {}) {
  const schoolList = options.schools || (school ? [school] : []);
  const schoolNodes = schoolList.map((name) => logSchoolChip(name, name === school ? tier : null));
  const reagentNode = reagents?.length ? logReagentRow(reagents, bonus) : null;
  const valueNodes = (Array.isArray(values) ? values : []).map(logValueChip);
  if (options.schoolAfterCard && schoolNodes.length >= 2) {
    const split = text.split(' free with ');
    if (split.length === 2) {
      return h('div', { class: 'log-inline' },
        h('span', { class: 'log-inline-text' }, split[0]), schoolNodes[0],
        h('span', { class: 'log-inline-text' }, ` free with ${split[1]}`), schoolNodes[1],
        reagentNode, ...valueNodes);
    }
  }
  if (options.summonGather) {
    return h('div', { class: 'log-inline' },
      h('span', { class: 'log-inline-text' }, text), ...schoolNodes,
      valueNodes.length ? h('span', { class: 'log-inline-separator' }, ' paying ') : null,
      ...valueNodes,
      reagentNode ? h('span', { class: 'log-inline-separator' }, ' gathered ') : null, reagentNode);
  }
  return h('div', { class: 'log-inline' },
    options.schoolBeforePaying && text.endsWith(' paying')
      ? [h('span', { class: 'log-inline-text' }, text.slice(0, -7)), ...schoolNodes, ' paying ']
      : [h('span', { class: 'log-inline-text' }, text), ...schoolNodes],
    reagentNode,
    options.valueLead && valueNodes.length ? h('span', { class: 'log-inline-separator' }, options.valueLead) : null,
    ...valueNodes);
}

function chronicleText(e) {
  let text = e.text;
  const schools = e.schools || (e.school ? [e.school] : []);
  for (const school of schools) {
    if (e.tier && school === e.school) {
      text = text.replace(new RegExp(`\\s+T${e.tier}\\s+\\(${school}\\)`, 'g'), '');
    }
    text = text.replace(new RegExp(`\\s+\\(${school}\\)`, 'g'), '');
  }
  if (e.tier) text = text.replace(new RegExp(`\\s+T${e.tier}(?=\\s|$)`), '');
  if (e.values?.length) {
    text = text
      .replace(/\s+for\s+\d+\s+mana\b/g, '')
      .replace(/\s+into\s+\d+\s+Gold\b/g, '')
      .replace(/:\s*[+-]\d+\s+(?:mana|Gold)(?:\s+total)?/g, '')
      .replace(/\s*\(?[+\u2212-]\d+\s+(?:mana|Gold)(?:\s+total)?\)?/gi, '')
      .replace(/\s+\(\+[0-9]+\s+mana\s+total\)/g, '');
  }
  if (e.act === 'build' && e.reagents?.length) return text.replace(/\s+paying.*$/, ' paying');
  if ((e.act === 'cast' || e.act === 'research') && e.reagents?.length) return text.replace(/\s+\([^()]*\)$/, '');
  return text;
}

export async function openLog(g) {
  const ov = openOverlay('drawer', { onScrim: (o) => o.close(), testid: 'log' });
  const list = h('div', { class: 'log-list', 'data-testid': 'log-list' }, h('div', { class: 'none' }, 'Reading the chronicle…'));
  appendNodes(ov.el, h('div', { class: 'drawer-panel' }, h('div', { class: 'drawer-head' }, h('span', { class: 'ttl' }, 'Chronicle'), closeBtn(() => ov.close(), 'log-close')), list));
  const r = await g.call('full_log');
  list.innerHTML = '';
  let round = null;
  for (const e of r.result || []) {
    if (e.act === 'turn') continue;
    if (e.r !== round) { round = e.r; appendNodes(list, h('div', { class: 'log-round' }, e.r ? `Round ${e.r}` : 'Setup')); }
    const thumbs = (e.cards || []).filter((k) => k && g.cards[k] && k !== e.cast);
    const castBlock = e.cast && g.cards[e.cast] ? h('div', { class: 'log-cast', 'data-testid': 'log-cast' },
      h('img', { src: art(e.cast), alt: e.cast, onclick: () => expandCard(g, e.cast) }),
      h('div', {}, h('div', { class: 'lc-name' }, g.cards[e.cast].display), h('div', { class: 'lc-text' }, g.cards[e.cast].effect))) : null;
    const gatherBlock = e.act === 'gather' && e.gather ? h('div', { class: 'log-gather-details' },
      logInlineReagents(`${e.who} gathered`, e.gather.reagents, e.gather.bonus, e.school, e.tier, e.values), logTracksRow(e.gather.tracks)) : null;
    const inlineReagents = !gatherBlock && (e.reagents?.length || e.school || e.schools?.length)
      ? logInlineReagents(chronicleText(e), e.reagents, [], e.school, e.tier, e.values, {
        schoolBeforePaying: e.act === 'build',
        summonGather: e.act === 'summon' && e.use === 'gather',
        valueLead: (e.act === 'convert' || e.act === 'convert1') ? ' for ' : null,
        schools: e.schools,
        schoolAfterCard: e.act === 'creation',
      })
      : null;
    const inlineValues = !gatherBlock && !inlineReagents && e.values?.length
      ? logInlineReagents(chronicleText(e), [], [], e.school, e.tier, e.values)
      : null;
    appendNodes(list, h('div', { class: 'log-item', 'data-testid': 'log-item' },
      h('span', { class: 'dot', style: { background: DOT[e.who] || '#9aa6cc' } }),
      h('div', { style: { flex: 1 } }, gatherBlock, inlineReagents || inlineValues || (!gatherBlock ? h('div', {}, chronicleText(e)) : null),
        thumbs.length ? h('div', { class: 'thumbs' }, thumbs.slice(0, 8).map((k) => h('img', { src: art(k), alt: k, onclick: () => expandCard(g, k) }))) : null,
        castBlock)));
  }
  list.scrollTop = list.scrollHeight;
  return ov;
}

// ------------------------------------------------------------------ shared pickers
function putbackPicker(g, host, pool, over) {
  const [p, done] = wait();
  const sel = new Set();
  const counter = h('span', { class: 'pill', 'data-testid': 'putback-count' }, `0 / ${over}`);
  const grid = h('div', { class: 'chips', 'data-testid': 'putback-pool' });
  pool.forEach((r, i) => {
    const b = h('button', { class: 'tokbtn', 'data-testid': `putback-${i}`, 'data-reagent': r, 'aria-label': nice(r) }, h('img', { src: reagentIcon(r), alt: nice(r) }));
    b.onclick = () => {
      if (sel.has(i)) { sel.delete(i); b.classList.remove('on'); g.sfx('unselect'); }
      else if (sel.size < over) { sel.add(i); b.classList.add('on'); g.sfx('select'); }
      counter.textContent = `${sel.size} / ${over}`;
      if (sel.size === over) setTimeout(() => done([...sel].map((j) => pool[j])), 220);
    };
    appendNodes(grid, b);
  });
  appendNodes(host, h('div', { class: 'phase-title' }, 'Storage full — put back reagents'),
    h('div', { class: 'counter' }, 'Put back', counter), grid);
  return p;
}

function castPicker(g, host, castable, { multi = false, title = 'Cast a spell with this gather?' } = {}) {
  const [p, done] = wait();
  const chosen = new Set();
  appendNodes(host, h('div', { class: 'phase-title' }, title));
  const row = h('div', { class: 'cast-row' });
  for (const c of castable) {
    const info = g.cards[c.key] || {};
    const el = h('button', { class: 'castopt', 'data-testid': `cast-${c.key}` },
      h('img', { src: art(c.key), alt: c.key }), h('div', { class: 'co-name' }, info.display || c.key), h('div', { class: 'co-text' }, info.effect || ''),
      c.cost?.length ? h('div', { class: 'co-cost' }, costIcons(c.cost)) : null);
    el.onclick = () => {
      if (!multi) { g.sfx('cast'); done({ cast: c }); return; }
      if (chosen.has(c.key)) { chosen.delete(c.key); el.classList.remove('on'); } else { chosen.add(c.key); el.classList.add('on'); }
      done({ toggle: c.key, chosen: [...chosen] });
    };
    appendNodes(row, el);
  }
  appendNodes(host, row);
  appendNodes(host, h('div', { class: 'actions' }, h('button', { class: 'act secondary', 'data-testid': 'skip-cast', onclick: () => done({ skip: true }) }, multi ? 'Done casting' : 'Skip cast')));
  return p;
}

export function xTargetPicker(g, host, maxX, title = 'Invisibility Potion') {
  const [p, done] = wait();
  let x = 1;
  const val = h('span', { class: 'val' }, '1');
  const opp = g.v.players.filter((q) => !q.you);
  const hasShield = (q) => (q.spells || []).some((sp) => sp.cast && /Spell_Spell_Shield/.test(sp.key || sp.img || ''));
  const chips = opp.map((q) => {
    const shielded = hasShield(q);
    const c = h('button', { class: `chip x-target-chip ${shielded ? 'shielded' : ''}`, disabled: shielded || null, 'data-testid': `x-target-${q.name}` },
      h('span', { class: 'x-target-who' }, avatar(q.name, 30), q.name),
      shielded ? h('span', { class: 'target-shield-badge', 'data-testid': `x-shielded-${q.name}` }, h('span', { class: 'target-shield-icon', 'aria-hidden': 'true' }), 'Shielded') : null);
    c.onclick = () => { g.sfx('select'); done({ x, target: q.name }); };
    return c;
  });
  appendNodes(host, h('div', { class: 'phase-title x-target-title' }, `${title}: pay X`, logReagentChip('Eye_of_Newt')),
    h('div', { class: 'stepper' }, h('button', { onclick: () => { x = Math.max(1, x - 1); val.textContent = x; } }, '−'), val, h('button', { onclick: () => { x = Math.min(maxX, x + 1); val.textContent = x; } }, '+')),
    h('div', { class: 'chips x-target-chips' }, chips));
  return p;
}

// ------------------------------------------------------------------ gather: keep taps -> cast -> put-back -> commit
const HOT = {
  3: [[0.19, 0.5], [0.5, 0.5], [0.81, 0.5]],
  4: [[0.27, 0.3], [0.73, 0.3], [0.27, 0.72], [0.73, 0.72]],
  5: [[0.19, 0.3], [0.5, 0.3], [0.81, 0.3], [0.33, 0.74], [0.67, 0.74]],
};
const HALF = { gather: [0.125, 0.485], increase: [0.565, 0.965] };

export async function gatherFlow(g, cid) {
  const L = g.v.legal.gather[cid];
  const ov = openOverlay('gather', { testid: 'gather' });
  let side = 'gather'; const sel = new Set(); let bloom = null; let busy = false;
  const icons = (sd) => (sd === 'gather' ? L.offers : L.raises);
  const need = (sd) => (sd === 'gather' ? L.keep : L.reversed_keep);
  const body = h('div', { class: 'gather-body' });
  appendNodes(ov.el, closeBtn(() => ov.close(), 'gather-cancel'), body);

  const renderKeep = () => {
    body.innerHTML = '';
    const wrap = h('div', { class: 'gcard-wrap', 'data-testid': 'gather-card' }, h('img', { class: 'gcard', src: art(cid), alt: cid }));
    for (const sd of ['gather', 'increase']) {
      const ic = icons(sd); const pos = HOT[ic.length] || HOT[3]; const [y0, y1] = HALF[sd];
      const live = sd === 'gather' || L.miracle;
      if (!live) continue;
      ic.forEach((r, i) => {
        const [x, y] = pos[i];
        const on = side === sd && sel.has(i);
        appendNodes(wrap, h('button', {
          class: `hot ${on ? 'on' : 'live'}`, 'data-testid': `hot-${sd}-${i}`, 'data-reagent': r, 'aria-label': nice(r),
          style: { left: `${x * 100}%`, top: `${(y0 + y * (y1 - y0)) * 100}%` },
          onclick: () => tapIcon(sd, i),
        }));
      });
    }
    if (L.miracle) appendNodes(wrap, h('span', { class: 'half-tag', style: { top: '57%', background: 'rgba(90,162,255,.85)' } }, 'Miracle: may gather this side'));
    appendNodes(body, wrap);
    appendNodes(body, h('div', { class: 'counter' }, 'Keep', h('span', { class: 'pill', 'data-testid': 'keep-counter' }, `${sel.size} / ${need(side)}`)));
    if (L.bonus.length) appendNodes(body, h('div', { class: 'chips' }, L.bonus.map((r) => h('span', { class: 'chip static' }, h('img', { src: reagentIcon(r), alt: '' }), '+1 wizard bonus'))));
    if (L.bloom) {
      appendNodes(body, h('div', { class: 'phase-title', style: { fontSize: '15px' } }, 'Bloom: +1 any reagent'),
        h('div', { class: 'chips' }, REAGENTS.map((r) => h('button', {
          class: `chip ${bloom === r ? 'on' : ''}`, 'data-testid': `bloom-${r}`,
          onclick: () => { bloom = r; g.sfx('select'); renderKeep(); maybeDone(); },
        }, h('img', { src: reagentIcon(r), alt: nice(r) })))));
    }
  };
  const tapIcon = (sd, i) => {
    if (busy) return;
    if (sd !== side) { side = sd; sel.clear(); }
    if (sel.has(i)) { sel.delete(i); g.sfx('unselect'); }
    else if (sel.size < need(side)) { sel.add(i); g.sfx('select'); }
    renderKeep(); maybeDone();
  };
  const maybeDone = () => {
    if (sel.size === need(side) && (!L.bloom || bloom)) { busy = true; setTimeout(() => proceed().catch((e) => { g.toast(String(e)); ov.close(); }), 260); }
  };
  const proceed = async () => {
    const keep = [...sel].sort((a, b) => a - b).map((i) => icons(side)[i]);
    const miracle = side === 'increase';
    const base = { card: cid, keep, bloom, miracle };
    const pr = await g.call('gather_preview', base);
    if (!pr.ok) { g.toast(pr.error); busy = false; sel.clear(); renderKeep(); return; }
    let pv = pr.result; let cast = null; let x = null; let target = null;
    if (pv.castable.length) {
      body.innerHTML = '';
      appendNodes(body, h('img', { class: 'mini-card', src: art(cid), alt: '' }),
        h('div', { class: 'chips' }, [...pv.got, ...pv.bonus].map((r) => h('span', { class: 'chip static glow' }, h('img', { src: reagentIcon(r), alt: '' }), nice(r)))));
      const ch = await castPicker(g, body, pv.castable);
      if (ch.cast) {
        cast = ch.cast.key;
        if (ch.cast.x !== undefined && ch.cast.x !== null) {
          body.innerHTML = ''; const xt = await xTargetPicker(g, body, ch.cast.x); x = xt.x; target = xt.target;
        }
        const p2 = await g.call('gather_preview', { ...base, cast, x });
        if (!p2.ok) { g.toast(p2.error); ov.close(); return; }
        pv = p2.result;
      }
    }
    let discard = null;
    if (pv.over > 0) {
      body.innerHTML = '';
      appendNodes(body, h('img', { class: 'mini-card', src: art(cid), alt: '' }));
      discard = await putbackPicker(g, body, pv.pool, pv.over);
    }
    const r = await g.act('act_gather', { ...base, cast, x, target, discard }, { sound: 'gather' });
    ov.close();
    if (r) { if (cast) g.sfx('cast'); g.afterAction(); }
  };
  renderKeep();
  return ov;
}

// ------------------------------------------------------------------ summon / research / build / recruit / convert
export function summonFlow(g, fk, { group = null, groupIndex = 0 } = {}) {
  const L = (g.v.legal.summon || {})[fk];
  if (!L) return;
  const familiarGroup = group && group.length ? group : [fk];
  expandCard(g, fk, {
    group: familiarGroup,
    groupIndex,
    actionLayout: 'tiles',
    compactTiles: true,
    actionPrompt: 'THEN PICK ONE',
    costInfo: (currentFamiliar) => {
      const current = (g.v.legal.summon || {})[currentFamiliar];
      const mana = g.v.players.find((p) => p.you)?.mana ?? 0;
      if (!current || current.cost == null) return null;
      return { cost: current.cost, mana, remaining: mana - current.cost, affordable: mana >= current.cost };
    },
    testid: 'summon-use',
    closeTestid: 'summon-cancel',
    actions: (currentFamiliar) => {
      const current = (g.v.legal.summon || {})[currentFamiliar] || {};
      const available = new Set(current.uses || []);
      const action = (use, label, detail, reason = `${label} unavailable`) => ({
        use, label, detail: available.has(use) ? detail : reason, disabled: !available.has(use), reagent: current.reagent,
        note: use === 'score' && current.powerful_helper ? 'Powerful Helper' : null,
        testid: `summon-${use}`, onClick: async (overlay) => {
          overlay.close();
          if (!available.has(use)) return null;
          if (use === 'gather') return summonGather(g, currentFamiliar);
          const from = slotRectOf(currentFamiliar);
          const r = await g.act('act_summon', { familiar: currentFamiliar, use }, { sound: use === 'score' ? 'coin' : 'select' });
          if (r) {
            const hit = (r.entries || []).find((e) => e.act === 'summon' && e.feedback);
            if (hit?.feedback) g.toast(hit.feedback);
            await fly(art(currentFamiliar), from, dockTarget());
            await g.afterAction();
          }
          return r;
        },
      });
      return [
        action('score', 'Score', `+${(current.score_gold || 0) + (current.powerful_helper || 0)} Gold`),
        action('gather', 'Gather', current.collect
          ? h('span', { class: 'familiar-action-chip-detail' }, logReagentChip(current.reagent, { count: current.collect }))
          : 'Gather unavailable'),
        action('dungeon', 'Dungeon', 'draw for treasure'),
        action('research', 'Research', 'reveal spells'),
      ];
    },
  });
}

async function summonGather(g, fk) {
  const ov = openOverlay('gather', { testid: 'summon-gather-flow' });
  const body = h('div', { class: 'gather-body' });
  appendNodes(ov.el, closeBtn(() => ov.close(), 'gather-cancel'), body);
  let casts = [];
  for (;;) {
    const pr = await g.call('summon_gather_preview', { familiar: fk, casts });
    if (!pr.ok) { g.toast(pr.error); ov.close(); return; }
    const pv = pr.result;
    if (!pv.castable.length && !casts.length) break;
    body.innerHTML = '';
    appendNodes(body, h('img', { class: 'mini-card', src: art(fk), alt: '' }), h('div', { class: 'chips' }, pv.got.map((r) => h('span', { class: 'chip static glow' }, h('img', { src: reagentIcon(r), alt: '' }), nice(r)))));
    const all = [...casts.map((k) => ({ key: k, cost: [] })), ...pv.castable];
    const pick = castPicker(g, body, all, { multi: true, title: 'Cast any of your spells' });
    body.querySelectorAll('.castopt').forEach((el, i) => { if (i < casts.length) el.classList.add('on'); });
    const ch = await pick;
    if (ch.skip) break;
    casts = ch.chosen;
  }
  const pr = await g.call('summon_gather_preview', { familiar: fk, casts });
  let discard = null;
  if (pr.ok && pr.result.over > 0) { body.innerHTML = ''; discard = await putbackPicker(g, body, pr.result.pool, pr.result.over); }
  const r = await g.act('act_summon', { familiar: fk, use: 'gather', casts, discard }, { sound: 'gather' });
  ov.close();
  if (r) { if (casts.length) g.sfx('cast'); g.afterAction(); }
}

export function researchFlow(g, sk, { group = null, groupIndex = 0 } = {}) {
  const spellGroup = (group && group.length ? group : (g.v.board.spell_face || []).filter(Boolean));
  const resolvedIdx = Number.isFinite(groupIndex) && groupIndex >= 0 ? groupIndex : spellGroup.indexOf(sk);
  const startIdx = resolvedIdx < 0 ? 0 : resolvedIdx;
  expandCard(g, sk, {
    group: spellGroup,
    groupIndex: startIdx,
    actions: (k) => {
      const L = (g.v.legal.research || {})[k];
      if (!L) return [];
      const cost = Object.entries(g.cards[k]?.cost?.reagents || {}).flatMap(([r, n]) => (n === 'X' ? [r] : Array.from({ length: n }, () => r)));
      return [
        { label: 'Research', sub: logValueChip({ kind: 'mana', value: L.mana }), testid: 'research-only', onClick: (overlay) => commitFromExpand(g, overlay, async () => {
          const from = slotRectOf(k);
          const r = await g.act('act_research', { spell: k, cast: false }, { sound: 'select' });
          if (r) fly(art(k), from, dockTarget());
          return r;
        }) },
        { label: 'Research & Cast', sub: h('span', { class: 'action-chip-row' },
          ...groupReagents(cost).map(({ reagent: r, count }) => logReagentChip(r, { count })),
          logValueChip({ kind: 'mana', value: L.mana })), testid: 'research-cast', disabled: !L.castable, onClick: async (overlay) => {
          let x = null, target = null;
          if (L.x) {
            overlay.el.innerHTML = ''; overlay.el.classList.add('gather');
            const eyes = g.me_().tok.filter((t) => t === 'Eye_of_Newt').length;
            const xt = await xTargetPicker(g, overlay.el, eyes, g.cards[k]?.name || 'Invisibility Potion'); x = xt.x; target = xt.target;
          }
          return commitFromExpand(g, overlay, async () => {
            const from = slotRectOf(k);
            const r = await g.act('act_research', { spell: k, cast: true, x, target }, { sound: 'cast' });
            if (r) fly(art(k), from, dockTarget());
            return r;
          });
        } },
      ];
    },
  });
}

export function buildFlow(g, towerKey = null, { group = null, groupIndex = 0 } = {}) {
  const B = g.v.legal.build;
  const tower = towerKey || B?.tower || g.v.board.tower_face;
  const towerGroup = (group && group.length ? group : [g.v.board.tower_face].filter(Boolean));
  const resolvedIdx = Number.isFinite(groupIndex) && groupIndex >= 0 ? groupIndex : towerGroup.indexOf(tower);
  const startIdx = resolvedIdx < 0 ? 0 : resolvedIdx;
  expandCard(g, tower, {
    group: towerGroup,
    groupIndex: startIdx,
    actions: (k) => {
      const buildLegal = g.v.legal.build;
      if (!buildLegal || buildLegal.tower !== k) return [];
      const build = (pay) => (overlay) => commitFromExpand(g, overlay, async () => {
        const from = slotRectOf(k);
        const r = await g.act('act_build', { pay }, { sound: 'build' });
        if (r) fly(art(k), from, dockTarget());
        return r;
      });
      return [
        buildLegal.reagent ? { label: 'Build with reagents', sub: h('span', { class: 'action-chip-row' },
          ...groupReagents(Array.from({ length: buildLegal.reagent.n }, () => buildLegal.reagent.reagent))
            .map(({ reagent: r, count }) => logReagentChip(r, { count }))), testid: 'build-reagent', onClick: build('reagent') } : null,
        buildLegal.gold ? { label: 'Build with Gold', sub: logValueChip({ kind: 'gold', value: buildLegal.gold.n }), testid: 'build-gold', onClick: build('gold') } : null,
      ].filter(Boolean);
    },
  });
}

export function divinationFlow(g) {
  expandCard(g, 'Spell_Divination', { actions: [
    { label: 'Enter the Dungeon', sub: 'Divination', testid: 'divination-enter', onClick: (overlay) => commitFromExpand(g, overlay, () => g.act('act_divination', {}, { sound: 'select' })) },
  ] });
}

export function convertSheet(g, reagent) {
  const L = g.v.legal;
  const c = L.convert[reagent]; let n = c.n;
  const energize = L.energize;
  const transformOn = !!L.transform;
  const adept = !!L.adept_conversion;
  const otherTypes = REAGENTS.filter((r) => r !== reagent && L.convert[r]);
  let r2 = ''; let n2 = 1;
  const transforms = [];
  const xSel = new Set();
  const virtualTok = () => {
    const t = [...g.me_().tok];
    for (const tr of transforms) {
      for (const r of tr.from) {
        const i = t.indexOf(r);
        if (i >= 0) t.splice(i, 1);
      }
      t.push(tr.to);
    }
    return t;
  };
  const countTok = (r) => virtualTok().filter((x) => x === r).length;
  const ov = openOverlay('sheet', { onScrim: (o) => o.close(), testid: 'convert' });
  const val = h('span', { class: 'val', 'data-testid': 'convert-n' }, String(n));
  const heldCount = h('div', { class: 'convert-held-count', 'data-testid': 'convert-held-count' });
  const val2 = h('span', { class: 'val', 'data-testid': 'convert-n2' }, '1');
  const gain = h('div', { class: 'gain' });
  const gain2 = h('div', { class: 'gain', 'data-testid': 'convert-gain2' });
  const secondRow = h('div', { class: 'stepper adept-stepper', style: { display: 'none' }, 'data-testid': 'convert-stepper2' });
  const xQueued = h('div', { class: 'chips', 'data-testid': 'transform-queue' });
  const xPick = h('div', { class: 'chips' });
  const xAdd = h('button', { class: 'chip', disabled: true, 'data-testid': 'transform-add' }, 'Transform (2:1)');
  const trackOf = (r) => (g.v.board.tracks[r] ?? 0);
  const mana = (value) => logValueChip({ kind: 'mana', value });
  const reagentCount = (r, count) => logReagentChip(r, { count });
  const choiceGroup = (options, selected, testPrefix, onPick) => h('div', { class: 'reagent-choice-group' },
    ...options.map((r) => {
      const b = h('button', {
        class: `reagent-choice reagent-choice-${String(r).toLowerCase().replaceAll('_', '-')} ${selected === r ? 'on' : ''}`,
        type: 'button',
        'data-testid': `${testPrefix}-${r}`,
        'aria-pressed': selected === r ? 'true' : 'false',
        onclick: () => onPick(r),
      },
      h('span', { class: 'reagent-choice-medallion' }, h('img', { src: reagentIcon(r), alt: '' })),
      h('span', { class: 'reagent-choice-copy' }, h('span', { class: 'reagent-choice-name' }, nice(r)),
        h('span', { class: 'reagent-choice-price' }, `${trackOf(r)} mana each`)));
      return b;
    }));
  let xTargetValue = reagent;
  const xTarget = choiceGroup(REAGENTS, xTargetValue, 'transform-target', (r) => {
    xTargetValue = r;
    xTarget.querySelectorAll('.reagent-choice').forEach((b) => {
      const selected = b.dataset.testid === `transform-target-${r}`;
      b.classList.toggle('on', selected);
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    g.sfx('select');
  });
  const rebuildSecondStepper = () => {
    secondRow.style.display = r2 ? 'flex' : 'none';
    secondRow.innerHTML = '';
    if (!r2) return;
    const c2 = L.convert[r2];
    n2 = Math.min(countTok(r2), Math.max(1, n2));
    appendNodes(secondRow, 
      h('button', { 'data-testid': 'convert-minus2', onclick: () => { n2 = Math.max(1, n2 - 1); upd(); g.sfx('tap'); } }, '−'), val2,
      h('button', { 'data-testid': 'convert-plus2', onclick: () => { n2 = Math.min(countTok(r2), n2 + 1); upd(); g.sfx('tap'); } }, '+'),
    );
  };
  const renderTransformPick = () => {
    if (!transformOn) return;
    xPick.innerHTML = '';
    virtualTok().forEach((r, i) => {
      const b = h('button', {
        class: `tokbtn ${xSel.has(i) ? 'on' : ''}`,
        'data-testid': `transform-pick-${i}`,
      }, h('img', { src: reagentIcon(r), alt: nice(r) }));
      b.onclick = () => {
        if (xSel.has(i)) { xSel.delete(i); g.sfx('unselect'); }
        else if (xSel.size < 2) { xSel.add(i); g.sfx('select'); }
        renderTransformPick();
        xAdd.disabled = xSel.size !== 2;
      };
      appendNodes(xPick, b);
    });
  };
  const renderTransformQueue = () => {
    xQueued.innerHTML = '';
    transforms.forEach((tr, i) => {
      appendNodes(xQueued, h('span', { class: 'chip static', 'data-testid': `transform-done-${i}` },
        `${tr.from.map(nice).join(' + ')} → ${nice(tr.to)}`,
        h('button', { class: 'linkish', 'data-testid': `transform-undo-${i}`, onclick: () => {
          transforms.splice(i, 1); renderTransformQueue(); renderTransformPick(); upd(); g.sfx('tap');
        } }, 'undo')));
    });
  };
  xAdd.onclick = () => {
    if (xSel.size !== 2) return;
    const vt = virtualTok();
    const fr = [...xSel].sort((a, b) => a - b).map((i) => vt[i]);
    transforms.push({ from: fr, to: xTargetValue });
    xSel.clear();
    renderTransformQueue();
    renderTransformPick();
    xAdd.disabled = true;
    n = Math.min(n, countTok(reagent));
    if (adept && r2) n2 = Math.min(n2, countTok(r2));
    upd();
    g.sfx('coin');
  };

  const upd = () => {
    const held = countTok(reagent);
    n = Math.min(n, held || 1);
    heldCount.textContent = `You have ${held}`;
    const base = c.value;
    const v = Math.min(12, base + (energize ? 3 : 0));
    const endTrack = Math.max(1, v - n);
    val.textContent = n;
    gain.innerHTML = '';
    if (energize) {
      const capped = base + 3 > 12;
      appendNodes(gain,
        h('div', { class: 'ov-sub energize-track', 'data-testid': 'convert-energize-note' },
          h('b', {}, `${nice(reagent)} track ${base} + 3 Energize = ${v}${capped ? ' (capped at 12)' : ''}`)),
        h('div', { 'data-testid': 'convert-gain-math' },
          reagentCount(reagent, n), ' × ', mana(v), ' → ', mana(n * v)));
    } else {
      appendNodes(gain, h('div', { 'data-testid': 'convert-gain-math' },
        reagentCount(reagent, n), ' × ', mana(v), ' → ', mana(n * v)),
      h('div', { class: 'ov-sub convert-price-drop' }, 'Price drops to ', mana(endTrack), ' each'));
    }
    if (adept && r2) {
      const c2 = L.convert[r2] || { n: countTok(r2), value: trackOf(r2) };
      n2 = Math.min(Math.max(1, n2), countTok(r2));
      val2.textContent = String(n2);
      const tv = trackOf(r2);
      gain2.innerHTML = '';
      appendNodes(gain2, reagentCount(r2, n2), ' × ', mana(tv), ' → ', mana(n2 * tv));
    } else {
      gain2.innerHTML = '';
      val2.textContent = '1';
      n2 = 1;
    }
  };
  const type2Pick = h('div', { class: 'reagent-choice-group', 'data-testid': 'convert-adept-type2' });
  const renderType2Choices = () => {
    type2Pick.innerHTML = '';
    appendNodes(type2Pick, ...otherTypes.map((r) => {
      const b = h('button', {
        class: `reagent-choice reagent-choice-${String(r).toLowerCase().replaceAll('_', '-')} ${r2 === r ? 'on' : ''}`,
        type: 'button',
        'data-testid': `convert-adept-type2-${r}`,
        'aria-pressed': r2 === r ? 'true' : 'false',
        onclick: () => {
          r2 = r2 === r ? '' : r;
          b.parentElement.querySelectorAll('.reagent-choice').forEach((el) => {
            const selected = el.dataset.testid === `convert-adept-type2-${r2}`;
            el.classList.toggle('on', selected);
            el.setAttribute('aria-pressed', selected ? 'true' : 'false');
          });
          rebuildSecondStepper();
          upd();
          g.sfx(r2 ? 'tap' : 'unselect');
        },
      },
      h('span', { class: 'reagent-choice-medallion' },
        h('img', { src: reagentIcon(r), alt: '' }),
        h('span', { class: 'reagent-choice-count', 'data-testid': `convert-count-${r}` }, `×${countTok(r)}`)),
      h('span', { class: 'reagent-choice-copy' }, h('span', { class: 'reagent-choice-name' }, nice(r)),
        h('span', { class: 'reagent-choice-price' }, `${trackOf(r)} mana each`)));
      return b;
    }));
  };
  if (adept) {
    renderType2Choices();
  }
  const onGo = async () => {
    const args = adept && r2
      ? { reagent, n, energize, reagent2: r2, n2, ...(transforms.length ? { transforms } : {}) }
      : { reagent, n, energize, ...(transforms.length ? { transforms } : {}) };
    const r = await g.act('act_convert', args, { sound: 'coin' }); ov.close(); if (r) g.afterAction();
  };
  const panel = h('div', { class: 'sheet-panel' },
    h('img', { class: 'big-icon', src: reagentIcon(reagent), alt: '' }),
    h('div', { class: 'phase-title' }, `Convert ${nice(reagent)}`),
    heldCount,
    transformOn ? h('div', { class: 'transform-block', 'data-testid': 'convert-transform' },
      h('div', { class: 'ov-sub' }, 'Transform (2:1): pick any 2 tokens, then one target type (repeatable before selling).'),
      xPick,
      h('label', { class: 'sr-only', for: 'transform-target' }, 'Transform into'),
      xTarget,
      xAdd,
      xQueued) : null,
    adept ? h('div', { class: 'ov-sub', 'data-testid': 'convert-adept-banner' }, 'Adept Conversion: you may also sell a second type.') : null,
    h('div', { class: 'stepper' }, h('button', { 'data-testid': 'convert-minus', onclick: () => { n = Math.max(1, n - 1); upd(); g.sfx('tap'); } }, '−'), val,
      h('button', { 'data-testid': 'convert-plus', onclick: () => { n = Math.min(countTok(reagent), n + 1); upd(); g.sfx('tap'); } }, '+')),
    gain,
    adept ? h('div', { class: 'adept-second' },
      h('div', { class: 'adept-second-label' }, 'Also sell a second type ', h('span', {}, '(optional)')),
      type2Pick,
      secondRow) : null,
    adept ? gain2 : null,
    h('div', { class: 'actions' }, h('button', { class: 'act', 'data-testid': 'convert-go', onclick: onGo }, 'Convert')),
    L.convert1 ? h('button', { class: 'linkish', 'data-testid': 'convert-mixed', onclick: () => { ov.close(); convertMixed(g); } },
      'Sell a mix of reagents at ', logValueChip({ kind: 'mana', value: 1 }), ' each') : null);
  appendNodes(ov.el, panel);
  if (adept) rebuildSecondStepper();
  if (transformOn) { renderTransformPick(); renderTransformQueue(); }
  upd();
}

function convertMixed(g) {
  const me = g.me_(); const sel = new Set();
  const ov = openOverlay('sheet', { onScrim: (o) => o.close(), testid: 'convert1' });
  const go = h('button', { class: 'act', disabled: true, 'data-testid': 'convert1-go' }, 'Sell');
  const grid = h('div', { class: 'chips' }, me.tok.map((r, i) => {
    const b = h('button', { class: 'tokbtn', 'data-testid': `mix-${i}` }, h('img', { src: reagentIcon(r), alt: nice(r) }));
    b.onclick = () => {
      if (sel.has(i)) sel.delete(i); else sel.add(i);
      b.classList.toggle('on', sel.has(i));
      go.disabled = !sel.size;
      replaceChildren(go, `Sell ${sel.size} for `, logValueChip({ kind: 'mana', value: sel.size }));
    };
    return b;
  }));
  go.onclick = async () => { const r = await g.act('act_convert1', { reagents: [...sel].map((i) => me.tok[i]) }, { sound: 'coin' }); ov.close(); if (r) g.afterAction(); };
  appendNodes(ov.el, h('div', { class: 'sheet-panel' },
    h('div', { class: 'phase-title' }, 'Sell any mix at ', logValueChip({ kind: 'mana', value: 1 }), ' each'),
    grid, h('div', { class: 'actions' }, go)));
}

export function announceSpellEffectResults(g, entries) {
  for (const e of entries || []) {
    if (e.feedback) g.toast(e.feedback);
  }
}

export function showTimeShiftRemoved(g, entry) {
  const keys = entry.cards || [];
  if (!keys.length) return Promise.resolve();
  return new Promise((resolve) => {
    expandCard(g, keys[0], {
      group: keys,
      groupIndex: 0,
      title: 'Time Shift: removed from play',
      titleTestid: 'time-shift-title',
      actions: [{ label: 'Done', testid: 'time-shift-done', onClick: async () => { resolve(); } }],
    });
  });
}

// ------------------------------------------------------------------ pending steps: spell effects, New Research, dungeon
export async function effectChooser(g) {
  closeAll(); // e.g. Research & Cast leaves expand open while settle runs; don't block the target picker underneath
  const pd = g.v.pending; const k = pd.spell; const info = g.cards[k] || {};
  const ov = openOverlay('gather', { testid: 'effect' });
  const [p, done] = wait();
  appendNodes(ov.el, h('div', { class: 'chooser-head' }, h('img', { src: art(k), alt: k, onclick: () => expandCard(g, k) }),
    h('div', {}, h('div', { class: 'phase-title' }, info.display), h('div', { class: 'ov-sub' }, info.effect))));
  const opts = pd.options;
  const grid = h('div', { class: 'opt-grid', 'data-testid': 'effect-options' });
  const pick = (choice) => () => { g.sfx('select'); done(choice); };
  const kind = pd.kind;
  const playerData = (name) => g.v.players.find((p) => p.name === name);
  if (['flame_bolt', 'disintegrate', 'earthquake', 'charm', 'creation', 'demonic_possession'].includes(kind)) {
    const byP = {};
    for (const o of opts) (byP[o.player || 'Available'] ||= []).push(o);
    for (const [pl, os] of Object.entries(byP)) {
      const pData = pl !== 'Available' ? playerData(pl) : null;
      const labelContent = pData ? [pl, ' ', h('span', { class: 'stat mana mini', 'data-testid': `${pl}-mana` }, h('span', { class: 'orb' }), pData.mana === null ? '?' : pData.mana), h('span', { class: 'stat vp mini', 'data-testid': `${pl}-vp` }, `${pData.vp} VP`)] : pl;
      appendNodes(grid, h('div', { class: 'group-label' }, labelContent));
      const cardLabel = (o) => g.cards[o.card]?.display || g.cards[o.card]?.name || nice(o.card);
      os.forEach((o) => appendNodes(grid, h('button', { class: 'opt-card', 'data-testid': `target-${pl}-${o.card}`, onclick: pick(o) }, h('img', { src: art(o.card), alt: o.card }), h('span', { class: 'oc-label' }, cardLabel(o)))));
    }
  } else if (kind === 'mana_drain' || kind === 'obscure') {
    appendNodes(grid, ...opts.map((o) => {
      const pData = playerData(o.player);
      return h('button', { class: 'chip player-chip', 'data-testid': `target-${o.player}`, onclick: pick(o) },
        avatar(o.player, 30),
        h('div', { class: 'chip-col' },
          h('div', { class: 'chip-name' }, o.player),
          h('div', { class: 'chip-stats' },
            h('span', { class: 'stat mana mini', 'data-testid': `${o.player}-mana` }, h('span', { class: 'orb' }), pData?.mana === null ? '?' : pData?.mana ?? '?'),
            h('span', { class: 'stat vp mini', 'data-testid': `${o.player}-vp` }, `${pData?.vp ?? '?'} VP`))));
    }));
  } else if (kind === 'wand_tax') {
    appendNodes(grid, ...opts.map((o) => h('button', { class: 'chip', 'data-testid': `school-${o.school}`, onclick: pick(o) },
      h('img', { src: schoolIcon(o.school), alt: '' }), o.school, logValueChip({ kind: 'gold', value: o.gold }))));
  } else if (kind === 'time_shift') {
    appendNodes(grid, ...opts.map((o) => h('button', { class: 'chip', 'data-testid': `deck-${o.deck}`, onclick: pick(o) }, `${nice(o.deck)} · remove ${o.n}`)));
  } else if (kind === 'scry') {
    appendNodes(grid, ...opts.map((o) => h('button', { class: 'opt-card wide', 'data-testid': `scry-${o.card}`, onclick: pick(o) }, h('img', { src: art(o.card), alt: o.card }), h('span', { class: 'oc-text' }, g.cards[o.card]?.display || o.card))));
  } else if (kind === 'swapo') {
    const theirs = [...new Map(opts.map((o) => [`${o.player}|${o.card}`, o])).values()];
    appendNodes(grid, h('div', { class: 'group-label' }, 'Take one of theirs'));
    theirs.forEach((o) => appendNodes(grid, h('button', { class: 'opt-card', 'data-testid': `swapo-their-${o.card}`, onclick: () => {
      grid.innerHTML = ''; appendNodes(grid, h('div', { class: 'group-label' }, 'Give one of yours'));
      opts.filter((x) => x.player === o.player && x.card === o.card).forEach((x) => appendNodes(grid, h('button', { class: 'opt-card', 'data-testid': `swapo-mine-${x.mine}`, onclick: pick(x) }, h('img', { src: art(x.mine), alt: x.mine }))));
    } }, h('img', { src: art(o.card), alt: o.card }), h('span', { class: 'oc-label' }, o.player))));
  } else if (kind === 'transmute') {
    const tok = opts[0].tok; const sel = new Set();
    const go = h('button', { class: 'act', disabled: true, 'data-testid': 'transmute-go' }, 'Transmute');
    const goldBefore = g.me_().gold ?? 0;
    const summary = h('div', { class: 'transmute-summary', 'data-testid': 'transmute-summary' },
      h('div', { class: 'transmute-trade' }, h('b', {}, 'Transmute'), h('span', {}, '⚗ ×0 → '), logValueChip({ kind: 'gold', value: 0 })),
      h('div', { class: 'transmute-gold' }, h('b', {}, 'Your gold'), logValueChip({ kind: 'gold', value: goldBefore }), ' → ', logValueChip({ kind: 'gold', value: goldBefore })));
    const updateSummary = () => {
      const gain = Math.floor(sel.size / 2);
      summary.querySelector('.transmute-trade span').textContent = `⚗ ×${sel.size} → `;
      const values = summary.querySelectorAll('.transmute-trade .log-value-number, .transmute-gold .log-value-number');
      values[0].textContent = String(gain);
      values[2].textContent = String(goldBefore + gain);
    };
    appendNodes(grid, summary);
    appendNodes(grid, ...tok.map((r, i) => { const b = h('button', { class: 'tokbtn', 'data-testid': `transmute-${i}` }, h('img', { src: reagentIcon(r), alt: '' })); b.onclick = () => { if (sel.has(i)) { sel.delete(i); b.classList.remove('on'); } else { sel.add(i); b.classList.add('on'); } updateSummary(); go.disabled = sel.size < 2 || sel.size % 2; go.textContent = 'Transmute'; }; return b; }));
    appendNodes(grid, h('div', { class: 'actions' }, go));
    go.onclick = () => done({ reagents: [...sel].map((i) => tok[i]) });
  } else if (kind === 'evolve' || kind === 'rise') {
    appendNodes(grid, ...opts.map((o) => h('button', { class: 'opt-card', 'data-testid': `${kind}-${o.familiar}`, onclick: pick(o) }, h('img', { src: art(o.familiar), alt: o.familiar }), h('span', { class: 'oc-label' }, o.school))));
  }
  appendNodes(ov.el, grid);
  const choice = await p;
  const r = await g.act('resolve_effect', { choice }, { sound: 'cast' });
  ov.close();
  if (!r) return null;
  announceSpellEffectResults(g, r?.entries);
  const ts = (r?.entries || []).find((e) => e.act === 'time_shift');
  if (ts) {
    const deckName = TIME_SHIFT_DECK_LABEL[ts.deck] || nice(ts.deck);
    g.toast(`${deckName} deck: ${ts.remaining} cards left`);
    await showTimeShiftRemoved(g, ts);
  }
  return r;
}

export async function newResearchChooser(g) {
  const pd = g.v.pending;
  const ov = openOverlay('gather', { testid: 'new-research' });
  const [p, done] = wait();
  appendNodes(ov.el, h('div', { class: 'chooser-head' }, h('img', { src: art(pd.familiar), alt: '' }),
    h('div', {}, h('div', { class: 'phase-title' }, 'New Research'), h('div', { class: 'ov-sub' }, 'Take one of the four new spells'))));
  appendNodes(ov.el, h('div', { class: 'opt-grid' }, pd.four.map((k) => {
    const c = g.cards[k] || {};
    const school = c.school && !['Wild', 'Arch-Mage'].includes(c.school) ? c.school : null;
    const name = (c.display || k).replace(school ? ` (${school})` : '', '');
    const cost = Object.entries(c.cost?.reagents || {}).flatMap(([r, n]) => n === 'X' ? [r] : Array.from({ length: n }, () => r));
    return h('button', { class: 'opt-card wide', 'data-testid': `nr-${k}`, onclick: () => done(k) },
      h('img', { src: art(k), alt: k }), h('span', { class: 'oc-text' }, name),
      school ? logSchoolChip(school) : null,
      h('span', { class: 'oc-cost' }, logValueChip({ kind: 'mana', value: -(c.cost?.mana ?? 5) }),
        ...groupReagents(cost).map(({ reagent: r, count }) => logReagentChip(r, { count }))),
      h('span', { class: 'oc-label' }, c.effect));
  })));
  const k = await p;
  const r = await g.act('choose_new_research', { spell: k }, { sound: 'select' });
  ov.close();
  return r;
}

function familiarActionIcon(use, reagent) {
  if (use === 'score') return h('span', { class: 'familiar-action-gold-orb', 'aria-hidden': 'true' });
  if (use === 'gather') return h('img', { src: reagentIcon(reagent), alt: '' });
  if (use === 'dungeon') return h('img', { src: 'art/icons/familiar-action-dungeon.webp', alt: '' });
  return h('span', { class: 'familiar-action-scroll', html: SPELL_SCROLL_ICON, 'aria-hidden': 'true' });
}

export async function riseUseChooser(g) {
  const pd = g.v.pending;
  return new Promise((resolve) => {
    const action = (use, label, detail) => ({
      use, label, detail, reagent: pd.reagent, testid: `rise-${use}`,
      onClick: async (overlay) => {
        overlay.close();
        if (use === 'gather') return resolve(await riseGather(g, pd));
        const r = await g.act('rise_use', { use }, { sound: use === 'score' ? 'coin' : 'select' });
        if (use === 'dungeon' && r) await dungeonFlow(g);
        if (use === 'research' && r) await newResearchChooser(g);
        resolve(r);
        return r;
      },
    });
    expandCard(g, pd.familiar, {
      title: pd.title || 'Rise',
      subtitle: pd.subtitle || 'Use this familiar',
      actionPrompt: 'Pick one action',
      actionLayout: 'tiles',
      testid: 'rise-use',
      actions: [
        action('score', 'Score', `+${pd.score_gold} Gold`),
        action('gather', 'Gather', `${pd.collect} ${nice(pd.reagent)}`),
        action('dungeon', 'Dungeon', 'draw until treasure'),
        action('research', 'Research', 'reveal spells'),
      ],
    });
  });
}

async function riseGather(g, pd) {
  const me = g.me_();
  const holdings = me.tok.concat(Array(pd.collect).fill(pd.reagent));
  const castable = [];
  for (const o of g.v.legal.research) {
    if (!o.castable || o.x) continue;
    const c = g.cards[o.key];
    const cost = Object.entries(c?.cost?.reagents || {}).flatMap(([r, n]) => Array.from({ length: Number(n) || 0 }, () => r));
    const covers = (have, need) => {
      const cnt = (list) => list.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
      return Object.entries(cnt(need)).every(([r, n]) => (have[r] || 0) >= n);
    };
    if (covers(holdings, cost)) castable.push({ key: o.key, cost });
  }
  const casts = [];
  const ov = openOverlay('gather', { testid: 'rise-gather-cast' });
  const [p, done] = wait();
  appendNodes(ov.el, h('div', { class: 'phase-title' }, 'Cast spells (optional)'));
  const grid = h('div', { class: 'opt-grid' });
  const go = h('button', { class: 'act', 'data-testid': 'rise-gather-done' }, 'Done');
  go.onclick = () => done();
  castable.forEach((o) => {
    const b = h('button', { class: 'opt-card wide', 'data-testid': `cast-${o.key}` },
      h('img', { src: art(o.key), alt: o.key }), h('span', { class: 'oc-text' }, g.cards[o.key]?.display));
    b.onclick = () => { casts.push(o.key); b.disabled = true; };
    appendNodes(grid, b);
  });
  appendNodes(ov.el, grid, h('div', { class: 'actions' }, go));
  await p;
  ov.close();
  const newHoldings = holdings.slice();
  for (const k of casts) {
    const o = castable.find((x) => x.key === k);
    for (const r of o.cost) {
      const i = newHoldings.indexOf(r);
      if (i >= 0) newHoldings.splice(i, 1);
    }
  }
  const over = Math.max(0, newHoldings.length - me.cap);
  let discard = null;
  if (over > 0) {
    discard = await pickPutbacks(g, newHoldings, over);
  }
  const r = await g.act('rise_use', { use: 'gather', casts, discard }, { sound: 'coin' });
  return r;
}

export async function dungeonFlow(g) {
  const ov = openOverlay('dungeon', { testid: 'dungeon' });
  let shown = 0;
  for (;;) {
    const pd = g.v.pending;
    if (!pd || pd.type !== 'dungeon') break;
    ov.el.innerHTML = '';
    const [p, done] = wait();
    const pips = Array.from({ length: pd.limit }, (_, i) => h('span', { class: `hitpip ${i < pd.hits ? 'hit' : ''}` }, i < pd.hits ? '✸' : ''));
    const deck = h('div', { class: `deck dungeon ddeck ${pd.done ? '' : 'live'}`, 'data-testid': 'dungeon-deck' }, h('div', { class: 'mono' }, 'LW'), h('div', { class: 'dname' }, 'Dungeon'), h('div', { class: 'dcount' }, `${Math.max(0, pd.deck - pd.draws)} cards`));
    if (!pd.done) deck.onclick = () => done('flip');
    const row = h('div', { class: 'drawn', 'data-testid': 'dungeon-drawn' }, pd.drawn.map((k, i) => h('div', {
      class: `dc ${i >= shown ? 'new' : ''} ${pd.drawn_cards[i].type !== 'Treasure' ? 'monster' : ''}`, onclick: () => expandCard(g, k) }, h('img', { src: art(k), alt: k }))));
    shown = pd.drawn.length;
    appendNodes(ov.el, h('div', { class: 'ov-title' }, 'The Dungeon'),
      h('div', { class: 'hits', 'data-testid': 'dungeon-hits' }, 'Hits', ...pips, h('span', {}, `${pd.hits} / ${pd.limit}`)),
      deck, row);
    const acts = h('div', { class: 'actions' });
    if (pd.done) {
      appendNodes(ov.el, h('div', { class: `result ${pd.success ? 'good' : 'bad'}` }, pd.success ? 'The dungeon is exhausted' : 'Defeated! You keep nothing'));
      appendNodes(acts, h('button', { class: 'act', 'data-testid': 'dungeon-continue', onclick: () => done('stop') }, 'Continue'));
    } else if (pd.draws >= 1) {
      appendNodes(acts, h('button', { class: 'act', 'data-testid': 'dungeon-stop', onclick: () => done('stop') }, 'Stop & collect'));
    } else {
      appendNodes(acts, h('div', { class: 'ov-sub' }, 'Tap the deck to flip the first card'));
      appendNodes(acts, h('button', { class: 'act secondary', 'data-testid': 'dungeon-leave', onclick: () => done('leave') }, 'Leave'));
    }
    appendNodes(ov.el, acts);
    const a = await p;
    if (a === 'flip') {
      g.sfx('flip');
      const r = await g.act('dungeon_flip', {});
      const nd = r?.view?.pending;
      if (nd && nd.hits > pd.hits) setTimeout(() => g.sfx('hit'), 250);
    } else if (a === 'leave') {
      await g.act('dungeon_cancel', {});
      break;
    } else {
      const was = pd;
      const r = await g.act('dungeon_stop', {}, { sound: was.success ? 'coin' : 'hit' });
      if (r && was.success) {
        const kept = was.drawn_cards.filter((c) => c.type === 'Treasure');
        const gold = kept.reduce((s, c) => s + (c.gold || 0), 0) + (was.bonus_gold || 0);
        const items = kept.filter((c) => c.subtype === 'Item').map((c) => c.name);
        ov.el.innerHTML = '';
        const loot = h('div', { class: 'drawn' }, was.kept.map((k) => h('div', { class: 'dc new' }, h('img', { src: art(k), alt: k }))));
        appendNodes(ov.el, h('div', { class: 'ov-title' }, 'The Dungeon'), h('div', { class: 'result good', 'data-testid': 'dungeon-result' },
          'Collected ', logValueChip({ kind: 'gold', value: gold }), items.length ? ` + ${items.join(', ')}` : ''), loot);
        await sleep(700);
        const gt = document.querySelector('[data-testid=my-gold]');
        loot.querySelectorAll('img').forEach((im, i) => setTimeout(() => { fly(im.src, im.getBoundingClientRect(), gt); g.sfx('coin'); }, i * 140));
        await sleep(900);
      }
      break;
    }
  }
  ov.close();
}

// ------------------------------------------------------------------ bidding arena
function seatPos(i, n) {
  // Keith (index 0 of the rotated order) on the left, then clockwise over the top to the right.
  const a = Math.PI + (n === 1 ? 0 : (i * Math.PI) / (n - 1));
  return [50 + 39 * Math.cos(a), 50 + 38 * Math.sin(a)];
}

export async function arena(g, { mode, wizard = null }) {
  const me = g.me;
  const ov = openOverlay('arena', { testid: 'arena' });
  const order0 = g.v.seat_order; const k = order0.indexOf(me);
  const ring = [...order0.slice(k), ...order0.slice(0, k)];
  const card = wizard || g.v.auction.card;
  const seats = {}; const bids = {};
  const ringEl = h('div', { class: 'arena-ring' });
  const high = h('div', { class: 'high', 'data-testid': 'arena-high' }, '');
  appendNodes(ringEl, h('div', { class: 'arena-center' }, h('div', { class: 'card-frame', 'data-testid': 'arena-card' }, h('img', { src: art(card), alt: card, onclick: () => expandCard(g, card) })),
    h('div', { class: 'ov-sub', style: { margin: 0, fontSize: '13px' } }, g.cards[card]?.display), high));
  ring.forEach((n, i) => {
    const [x, y] = seatPos(i, ring.length);
    const b = h('div', { class: 'bid', 'data-testid': `bid-${n}` }, '–');
    const pd = g.v.players.find((p) => p.name === n);
    const s = h('div', { class: 'seat', 'data-testid': `seat-${n}`, style: { left: `${x}%`, top: y < 50 ? `max(48px, ${y}%)` : `${y}%` } }, avatar(n, 44),
      h('div', { class: 'sname' }, n, pd && !pd.you && pd.level ? diffBadge(pd.level) : null), b);
    seats[n] = s; bids[n] = b; appendNodes(ringEl, s);
  });
  const bar = h('div', { class: 'bidbar', 'data-testid': 'bidbar' });
  const msg = h('div', { class: 'winner-banner' });
  appendNodes(ov.el, h('div', { class: 'ov-title' }, 'Wizard Auction'), ringEl, msg, bar);

  let shown = 0; let leader = null; let hi = 0;
  const showBid = async (who, val, fast) => {
    Object.values(seats).forEach((s) => s.classList.remove('active'));
    seats[who]?.classList.add('active');
    const b = bids[who]; if (!b) return;
    if (val === 'pass') { b.textContent = 'Pass'; seats[who].classList.add('passed'); g.sfx('pass'); }
    else { b.textContent = val; leader = who; hi = val; g.sfx('bid'); }
    Object.values(seats).forEach((s) => s.classList.remove('leader'));
    if (leader) seats[leader].classList.add('leader');
    high.textContent = leader ? `High bid ${hi} · ${leader}` : 'No bids yet';
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    await sleep(fast ? 120 : 650);
  };
  const playTail = async (tail, fast = false) => { for (; shown < tail.length; shown++) await showBid(tail[shown][0], tail[shown][1], fast || g.skip); };

  const controls = (min, max, opening, lead = null) => {
    const [p, resolve] = wait();
    const done = (x) => { bar.querySelectorAll('button, input').forEach((b) => { b.disabled = true; }); resolve(x); };
    bar.innerHTML = '';
    if (max < min) {
      appendNodes(bar, h('div', { class: 'ov-sub' }, `You have ${max} mana — you cannot beat ${min - 1}`), h('div', { class: 'bidbtns' }, h('button', { class: 'act secondary', 'data-testid': 'bid-pass', onclick: () => done({ pass: true }) }, 'Pass')));
      return p;
    }
    let val = min;
    const clamp = (x) => Math.min(max, Math.max(min, Math.round(+x) || min));
    const out = h('div', { class: 'bidval', 'data-testid': 'bid-value', 'data-min': min, 'data-max': max }, String(val), h('small', {}, ` / ${max} mana`));
    const bidBtn = h('button', { class: 'act', 'data-testid': 'bid-go', onclick: () => { val = clamp(val); done({ bid: val }); } }, opening ? 'Open bid' : 'Bid');
    const passBtn = h('button', { class: 'act secondary', 'data-testid': opening ? 'bid-cancel' : 'bid-pass', onclick: () => done(opening ? { cancel: true } : { pass: true }) }, opening ? 'Cancel' : 'Pass');
    const yourBid = h('span', {}, `${val}/${max} `, logValueChip({ kind: 'mana', value: max }));
    const bidSummary = h('div', { class: 'bid-summary', 'data-testid': 'bid-summary' },
      h('div', { class: 'bid-summary-row' }, h('b', {}, 'High bid'), h('span', {}, logValueChip({ kind: 'mana', value: Math.max(0, min - 1) }), lead ? ` ${lead}` : '')),
      h('div', { class: 'bid-summary-row' }, h('b', {}, 'Your bid'), yourBid));
    if (min === max) {
      // A range input with min == max is degenerate (iOS Safari lets the thumb report values outside it): offer the one bid.
      out.firstChild.textContent = String(val);
      appendNodes(bar, bidSummary, h('div', { class: 'ov-sub', style: { margin: 0 } }, `${val} is all your mana`), h('div', { class: 'bidbtns' }, passBtn, bidBtn));
      return p;
    }
    const sl = h('input', { type: 'range', class: 'slider', min, max, value: val, step: 1, 'data-testid': 'bid-slider' });
    const show = () => { sl.value = val; out.firstChild.textContent = String(val); yourBid.firstChild.textContent = `${val}/${max} `; };
    sl.oninput = () => { val = clamp(sl.value); show(); };
    const step = (d) => () => { val = clamp(val + d); show(); g.sfx('tap'); };
    appendNodes(bar, bidSummary, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      h('button', { class: 'tb-btn', 'data-testid': 'bid-minus', onclick: step(-1) }, '−'), sl, h('button', { class: 'tb-btn', 'data-testid': 'bid-plus', onclick: step(1) }, '+')),
      h('div', { class: 'bidbtns' }, passBtn, bidBtn));
    return p;
  };

  const finish = async () => {
    bar.innerHTML = '';
    const lg = await g.call('full_log');
    const e = [...(lg.result || [])].reverse().find((x) => (x.act === 'auction' || x.act === 'auction_nobid') && (x.cards || []).includes(card));
    if (e && e.bids) await playTail(e.bids);
    if (e && e.act === 'auction') {
      const w = e.who;
      Object.values(seats).forEach((s) => s.classList.remove('active'));
      seats[w]?.classList.add('winner');
      const ci = ringEl.querySelector('.arena-center img');
      if (ci && seats[w]) fly(art(card), ci.getBoundingClientRect(), seats[w].querySelector('.avatar'), { w: 40, hgt: 56 });
      replaceChildren(msg, `${w === me ? 'You win' : w + ' wins'} ${g.cards[card]?.name || ''} for `, logValueChip({ kind: 'mana', value: e.price }));
      msg.setAttribute('data-testid', 'arena-winner');
      g.sfx(w === me ? 'win' : 'coin');
    } else msg.textContent = 'Nobody bid';
    await sleep(g.skip ? 300 : 1500);
  };

  try {
    if (mode === 'open') {
      high.textContent = 'Open the bidding';
      const mana = g.me_().mana;
      const c = await controls(1, mana, true);
      if (c.cancel) { ov.close(); return null; }
      const r = await g.act('act_recruit', { wizard: card, opening: c.bid }, { sound: 'bid' });
      if (!r) { ov.close(); return null; }
    }
    // This arena shows one auction. The engine can resolve it and start another one (e.g. the AI that lost takes another
    // action) inside the same call; then this arena shows the result and settle() opens a fresh arena for the new auction.
    let ident = null; let lastTail = [];
    for (;;) {
      const a = g.v.auction;
      if (!a) { await finish(); break; }
      const sig = `${a.card}|${a.starter}|${JSON.stringify(a.tail[0])}`;
      const extends_ = lastTail.every((x, i) => JSON.stringify(a.tail[i]) === JSON.stringify(x));
      if (ident === null && a.card === card) ident = sig;
      if (sig !== ident || !extends_) { await finish(); break; }
      lastTail = a.tail.map((x) => [...x]);
      await playTail(a.tail, mode === 'respond' && shown === 0 && a.tail.length > 4);
      if (a.waiting !== me) { await sleep(300); continue; }
      Object.values(seats).forEach((s) => s.classList.remove('active'));
      seats[me].classList.add('active');
      const c = await controls(a.high + 1, g.me_().mana, false, a.who);
      const r = c.pass ? await g.act('act_pass', {}) : await g.act('act_bid', { n: c.bid });
      if (!r) { const vr = await g.call('view'); if (vr.ok) g.setView(vr.result); }
    }
  } finally { ov.close(); }
  return true;
}

// ------------------------------------------------------------------ AI move banners
// One banner per AI turn stays up and steps through that AI's moves, each long enough to read.
// A tap anywhere jumps to the next move; "Skip" finishes the AI turns at once (g.skip).
export const AI_MOVE_MS = 4400;
export const AI_CAST_MS = 5000;
export const aiMoveMs = (e) => (e.cast ? AI_CAST_MS : AI_MOVE_MS);

function gatherBanner(g, e) {
  const data = e.gather;
  if (!data) return null;
  const chip = ({ reagent: r, count }) => h('span', {
    class: 'bgather-chip',
    'data-testid': 'ai-gather-reagent',
  }, h('img', { src: reagentIcon(r), alt: nice(r) }),
  count >= 2 ? h('span', { class: 'bgather-count' }, `×${count}`) : null);
  const track = ({ reagent: r, count }) => h('span', { class: 'bgather-track', 'data-testid': 'ai-gather-track' },
    h('img', { src: reagentIcon(r), alt: nice(r) }), h('span', { class: 'bgather-count' }, `▲+${count}`));
  const reagents = groupReagents(data.reagents || [], data.bonus || []);
  const tracks = groupReagents(data.tracks || []);
  return h('div', { 'data-testid': 'ai-banner-text' },
    h('div', { class: 'bgather', 'data-testid': 'ai-gather-structured' },
      h('div', { class: 'bgather-headline' }, `${e.who || 'AI'} gathered`),
      h('div', { class: 'bgather-chips' },
        ...reagents.map(chip)),
      h('div', { class: 'bgather-divider' }),
      h('div', { class: 'bgather-tracks-label' }, 'Tracks up:'),
      h('div', { class: 'bgather-tracks' }, ...tracks.map(track))));
}

function sellBanner(g, e) {
  const data = e.sell;
  if (!data) return null;
  const sales = Array.isArray(data.sales) ? data.sales : [];
  const chip = (sale) => h('span', { class: 'bsell-chip', 'data-testid': 'ai-sell-reagent' },
    h('img', { src: reagentIcon(sale.reagent), alt: nice(sale.reagent) }),
    sale.n >= 2 ? h('span', { class: 'bsell-count' }, `×${sale.n}`) : null);
  return h('div', { 'data-testid': 'ai-banner-text' },
    h('div', { class: 'bsell', 'data-testid': 'ai-sell-structured' },
      h('div', { class: 'bsell-headline' }, `${e.who || 'AI'} sold`),
      h('div', { class: 'bsell-row' },
        h('div', { class: 'bsell-chips' }, ...sales.map(chip)),
        sales.length ? logValueChip({ kind: 'mana', value: sales[0].value }) : null,
        h('span', { class: 'bsell-arrow', 'aria-hidden': 'true' }, '→'),
        h('div', { class: 'bsell-gain', 'data-testid': 'ai-sell-mana' },
          logValueChip({ kind: 'mana', value: data.mana })))));
}

function structuredBanner(g, e) {
  const data = e.structured;
  if (!data) return null;
  const chip = (item) => {
    if (item.mana !== undefined || item.gold !== undefined) {
      return h('span', { class: 'bstructured-chip', 'data-testid': 'ai-structured-chip' },
        logValueChip({ kind: item.mana !== undefined ? 'mana' : 'gold', value: item.mana ?? item.gold }));
    }
    if (item.reagent) {
      const count = item.count || Number((item.label || '').match(/^-?(\d+)/)?.[1]) || 1;
      return h('span', { class: 'bstructured-chip', 'data-testid': 'ai-structured-chip' },
        logReagentChip(item.reagent, { count }));
    }
    const card = item.card && (g.cards[item.card] || item.card.startsWith('Dungeon_'));
    const label = item.school ? (item.label || '').replace(new RegExp(`\\s+T?\\d*\\s*\\(${item.school}\\)`), '') : item.label;
    return h('span', { class: `bstructured-chip${item.card ? ' card' : ''}`, 'data-testid': 'ai-structured-chip' },
      card ? h('img', { src: art(item.card), alt: '' }) : item.shield
        ? h('span', { class: 'structured-shield-icon', 'aria-hidden': 'true' }, '🛡')
        : item.school ? logSchoolChip(item.school) : item.deck ? h('span', { class: 'structured-deck-icon', 'aria-hidden': 'true' }, '✦') : null,
      h('span', {}, label),
      item.school && card ? logSchoolChip(item.school, item.tier) : null);
  };
  return h('div', { 'data-testid': 'ai-banner-text' },
    h('div', { class: 'bstructured', 'data-testid': 'ai-structured' },
      h('div', { class: 'bstructured-headline' }, data.headline),
      h('div', { class: 'bstructured-row' }, ...(Array.isArray(data.chips) ? data.chips : []).map(chip)),
      data.note ? h('div', { class: 'bstructured-note' }, data.note) : null));
}

function plainBanner(g, e) {
  if (!e.text) return null;
  const values = Array.isArray(e.values) ? e.values : [];
  const reagents = Array.isArray(e.reagents) ? e.reagents : [];
  const hasChips = e.school || values.length || reagents.length;
  if (!hasChips) return null;
  return h('div', { 'data-testid': 'ai-banner-text' },
    h('div', { class: 'bstructured plain-structured', 'data-testid': 'ai-plain-structured' },
      h('div', { class: 'bstructured-headline' }, chronicleText(e)),
      h('div', { class: 'bstructured-row' },
        e.school ? logSchoolChip(e.school, e.tier) : null,
        reagents.length ? [logReagentRow(reagents)] : [],
        ...values.map(logValueChip))));
}

export async function banner(g, e, i = 0, n = 1) {
  if (g.skip) return;
  const layer = document.getElementById('banner-layer');
  const imgs = (e.cast ? [e.cast] : (e.cards || [])).filter((k) => g.cards[k]).slice(0, 4);
  const extra = e.cast && g.cards[e.cast] ? h('div', { style: { fontSize: '12.5px', color: '#d8ccff', marginTop: '3px' } }, `“${g.cards[e.cast].effect}”`) : null;
  const dur = aiMoveMs(e);
  let el = layer.querySelector('.banner:not(.out)');
  if (!el) { el = h('div', { class: 'banner', 'data-testid': 'ai-banner' }); replaceChildren(layer, el); }
  else { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
  el.dataset.move = `${i + 1}/${n}`;
  replaceChildren(el,
    avatar(e.who || '?'),
    h('div', { class: 'btext' },
      h('div', { class: 'bhead' }, `${e.who || 'AI'}'s turn${n > 1 ? ` · move ${i + 1} of ${n}` : ''}`),
      gatherBanner(g, e) || sellBanner(g, e) || structuredBanner(g, e) || plainBanner(g, e) || h('div', { 'data-testid': 'ai-banner-text' }, e.text), extra,
      h('div', { class: 'bfoot' }, h('span', { class: 'skiphint' }, i + 1 < n ? 'tap anywhere: next move' : 'tap anywhere to continue'),
        h('button', { class: 'bskip', 'data-testid': 'ai-skip', onclick: () => { g.skip = true; } }, 'Skip ⏭'))),
    imgs.length ? h('div', { class: 'bcards' }, imgs.map((k) => h('img', { src: art(k), alt: k }))) : null,
    h('div', { class: 'bprog', style: { animationDuration: `${dur}ms` } }));
  g.skipMove = false;
  const t0 = Date.now();
  while (Date.now() - t0 < dur && !g.skip && !g.skipMove) await sleep(50);
  g.skipMove = false;
}

export async function bannerDone(g) {
  const el = document.querySelector('#banner-layer .banner:not(.out)');
  if (!el) return;
  el.classList.add('out'); await sleep(g.skip ? 60 : 220); el.remove();
}

// ------------------------------------------------------------------ game over + menu
export function ranking(v) {
  const ranks = Object.entries(v.final || {}).sort((x, y) => y[1] - x[1]);
  const top = ranks.length ? ranks[0][1] : 0;
  const winners = ranks.filter(([, pts]) => pts === top).map(([n]) => n);
  return { ranks, winners, text: winners.length > 1 ? `Tie: ${winners.join(' & ')}` : `${winners[0]} wins` };
}

function rankRows(v, cls = 'rank') {
  const { ranks, winners } = ranking(v);
  return ranks.map(([n, pts]) => h('div', { class: `${cls} ${winners.includes(n) ? 'first' : ''}`, 'data-testid': `final-${n}` }, avatar(n, 30), h('span', {}, n), h('span', { class: 'pts' }, `${pts} VP`)));
}

export function gameOver(g) {
  const v = g.v; const ov = openOverlay('final', { testid: 'game-over' });
  appendNodes(ov.el, h('div', { class: 'ov-title' }, 'Game Over'), h('div', { class: 'winner', 'data-testid': 'winner' }, ranking(v).text), ...rankRows(v),
    h('div', { class: 'actions' },
      h('button', { class: 'act', 'data-testid': 'go-play-again', onclick: () => { ov.close(); replayNewGame(g); } }, 'Play again'),
      h('button', { class: 'act secondary', 'data-testid': 'go-new-setup', onclick: () => { ov.close(); openNewGameSetup(g); } }, 'New setup'),
      h('button', { class: 'act secondary', 'data-testid': 'go-mats', onclick: () => { ov.close(); openMats(g); } }, 'View mats'),
      h('button', { class: 'act secondary', 'data-testid': 'go-close', onclick: () => ov.close() }, 'Close')));
  g.sfx('win');
}

export function menu(g) {
  const v = g.v;
  const ov = openOverlay('sheet', { onScrim: (o) => o.close(), testid: 'menu' });
  const scores = v.game_over ? [h('div', { class: 'phase-title', 'data-testid': 'menu-winner' }, `Final scores · ${ranking(v).text}`), h('div', { class: 'menu-scores', 'data-testid': 'menu-scores' }, rankRows(v))] : [];
  appendNodes(ov.el, h('div', { class: 'sheet-panel' }, h('button', { class: 'sheet-close', 'aria-label': 'Close', 'data-testid': 'menu-close', onclick: () => ov.close() }, '×'),
    ...(scores.length ? scores : [h('div', { class: 'phase-title' }, 'Game')]),
    h('div', { class: 'actions' },
      h('button', { class: v.game_over ? 'act' : 'act secondary', 'data-testid': 'menu-new-game', onclick: () => { ov.close(); openNewGameSetup(g); } }, 'New game'),
      v.game_over ? h('button', { class: 'act secondary', 'data-testid': 'menu-play-again', onclick: () => { ov.close(); replayNewGame(g); } }, 'Play again') : null,
      v.game_over ? h('button', { class: 'act secondary', 'data-testid': 'menu-final-scores', onclick: () => { ov.close(); gameOver(g); } }, 'Final scores') : null,
      h('button', { class: 'act secondary', 'data-testid': 'menu-export', onclick: () => { ov.close(); g.exportSave(); } }, 'Export save file'),
      h('button', { class: 'act secondary', 'data-testid': 'menu-import', onclick: () => { ov.close(); g.importSave(); } }, 'Import save file'),
      h('button', { class: 'act bug-report-btn', 'data-testid': 'menu-bug-report', onclick: async () => {
        ov.close();
        try {
          const BugReport = await import('./bug-report.js');
          BugReport.openBugReportDialog(g);
        } catch (e) {
          console.error('[bug-report] Failed to load bug report UI:', e);
          g.toast('Bug report could not open. Check the console or try again.');
        }
      } }, '🐛 Report Bug'),
      h('button', { class: 'act danger', 'data-testid': 'menu-restart', onclick: () => { ov.close(); g.restart(); } }, 'Load the paused game g8')),
    h('div', { class: 'ov-sub' }, g.savedNote()),
    h('div', { class: 'menu-version', 'data-testid': 'menu-version' }, versionLabel())));
}

export async function openNewGameSetup(g) {
  const { runSetupWizard } = await import('./setup.js');
  const cfg = await runSetupWizard(g);
  if (!cfg) return;
  await newGameWithConfig(g, cfg);
}

export async function replayNewGame(g) {
  const cfg = Store.loadSetup() || Store.defaultSetup();
  await newGameWithConfig(g, cfg);
}

// Legacy entry (tests): skip wizard, use last saved setup or default Keith vs 2 AIs.
export async function newGame(g) {
  const cfg = Store.loadSetup() || Store.defaultSetup();
  await newGameWithConfig(g, cfg);
}

async function newGameWithConfig(g, config) {
  // A new deal must replace the autosave, never resume it after setup/replay.
  Store.clearLocal();
  const ov = openOverlay('gather newgame', { testid: 'new-game' });
  appendNodes(ov.el, closeBtn(() => ov.close(), 'new-game-cancel'), h('div', { class: 'ov-title' }, 'New game'), h('div', { class: 'ov-sub' }, 'Dealing…'));
  const seeds = g.nextGameSeeds || {};
  const pr = await g.call('new_game_preview', { seed: seeds.seed, ai_seed: seeds.ai_seed, config });
  if (ov.closed) return;
  if (!pr.ok) { g.toast(pr.error); ov.close(); return; }
  const { hand, reagents, players, human } = pr.result;
  if (human) g.me = human;
  const picks = [];
  const start = h('button', { class: 'act setup-action setup-action-primary', disabled: true, 'data-testid': 'new-game-start' });
  const updateStart = () => {
    const sub = picks.length === 2 ? `Starting with ${nice(picks[0])} & ${nice(picks[1])}` : 'Pick 2 reagents';
    replaceChildren(start, h('span', { class: 'setup-action-title' }, 'Begin the game'),
      h('span', { class: 'setup-action-sub' }, sub));
    start.disabled = picks.length !== 2;
  };
  updateStart();
  const chips = reagents.map((r) => {
    const c = h('button', { class: 'chip', 'data-testid': `pick-${r}` }, h('img', { src: reagentIcon(r), alt: '' }), nice(r));
    c.onclick = () => {
      const i = picks.indexOf(r);
      if (i >= 0) { picks.splice(i, 1); c.classList.remove('on'); g.sfx('unselect'); }
      else if (picks.length < 2) { picks.push(r); c.classList.add('on'); g.sfx('select'); }
      updateStart();
    };
    return c;
  });
  ov.el.innerHTML = '';
  appendNodes(ov.el, closeBtn(() => ov.close(), 'new-game-cancel'), h('div', { class: 'ov-title' }, 'New game'),
    h('div', { class: 'ov-sub' }, `${players.join(', ')} · you sit first unless random first player applies. This replaces the current game (export first to keep it).`),
    h('div', { class: 'phase-title', style: { fontSize: '15px' } }, 'Your reagent cards'),
    h('div', { class: 'hand-preview', 'data-testid': 'new-game-hand' }, hand.map((k) => h('img', { src: art(k), alt: k, onclick: () => expandCard(g, k) }))),
    h('div', { class: 'phase-title', style: { fontSize: '15px' } }, 'Pick 2 different starting reagents'),
    h('div', { class: 'chips' }, chips), h('div', { class: 'actions' }, start));
  start.onclick = async () => {
    start.disabled = true;
    const r = await g.call('new_game_start', { picks, seed: seeds.board_seed });
    if (!r.ok) { g.toast(r.error); start.disabled = false; return; }
    closeAll();
    g.startedNewGame(r.view);
  };
}
