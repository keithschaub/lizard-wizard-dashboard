import { h, art, reagentIcon, schoolIcon, nice, REAGENTS, counts, avatar, tokenChip, costIcons, sleep, appendNodes, replaceChildren } from './dom.js';
import { versionLabel } from './version.js';
import { achievementTile, achievementBadge, achievementTitle, achievementFromText } from './achievements.js';

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
  if (!from || !toEl) return;
  const to = toEl.getBoundingClientRect();
  const img = h('img', { class: 'fly', src, alt: '', style: { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` } });
  appendNodes(document.body, img);
  requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(img.style, {
    left: `${to.left + to.width / 2 - w / 2}px`, top: `${to.top + to.height / 2 - hgt / 2}px`, width: `${w}px`, height: `${hgt}px`, opacity: '0.15', transform: 'rotate(-8deg)',
  })));
  setTimeout(() => img.remove(), 820);
}
const dockTarget = () => document.querySelector('[data-testid=my-vp]');
const slotRectOf = (key) => { const el = document.querySelector(`#board [data-key="${key}"]`); return el ? el.getBoundingClientRect() : null; };

// ------------------------------------------------------------------ card text (carddb only)
export function cardInfo(g, key) {
  const c = g.cards[key] || {};
  const meta = [];
  if (c.deck === 'Achievement') {
    meta.push(h('span', {}, `${c.vp ?? 10} VP when claimed`), achievementBadge(c));
  } else if (c.school) meta.push(h('span', {}, c.school !== 'Wild' ? h('img', { src: schoolIcon(c.school), alt: '' }) : null, ` ${c.school}`));
  if (c.deck === 'Spell') {
    meta.push(h('span', {}, c.duration === '1x' ? 'One-time (1x)' : 'Ongoing'));
    const rg = Object.entries(c.cost?.reagents || {});
    meta.push(h('span', {}, `${c.cost?.mana ?? 5} mana + `, ...rg.flatMap(([r, n]) => n === 'X' ? [h('img', { src: reagentIcon(r), alt: '' }), '×X'] : Array.from({ length: n }, () => h('img', { src: reagentIcon(r), alt: nice(r) })))));
  } else if (c.deck === 'Tower') {
    meta.push(h('span', {}, `Tier ${c.cost?.tier}`), h('span', {}, `Cost ${c.cost?.reagent_count} `, h('img', { src: reagentIcon(c.cost?.reagent), alt: '' }), ` or ${c.cost?.gold} Gold`));
  } else if (c.deck === 'Familiar') {
    meta.push(h('span', {}, `${c.cost?.mana} mana`));
  }
  let text;
  if (c.deck === 'Achievement') text = c.effect || '';
  else if (c.deck === 'Familiar' && c.effect) text = c.effect.split('||').map((part) => h('div', {}, part.trim().replace(' | ', ' · ')));
  else if (c.deck === 'Reagent') text = [h('div', {}, 'Gather: ', ...costIcons(c.gather_icons || [])), h('div', {}, 'Increase Value: ', ...costIcons(c.increase_icons || []))];
  else text = c.effect || '';
  return h('div', { class: 'cardinfo', 'data-testid': 'card-info' },
    h('div', { class: 'ci-name' }, c.deck === 'Achievement' ? achievementTitle(c) : (c.display || c.name || key)),
    meta.length ? h('div', { class: 'ci-meta' }, meta) : null,
    text ? h('div', { class: 'ci-text', 'data-testid': 'card-text' }, text) : null);
}

const TIME_SHIFT_DECK_LABEL = { wizards: 'Wizards', towers: 'Towers', familiars: 'Familiars', spells: 'Spells' };

export function expandCard(g, key, { actions = [], extra = null, group = null, groupIndex = 0, title = null, titleTestid = null } = {}) {
  // group: array of card keys for swipeable navigation, groupIndex: current card index in group
  const cards = (group && group.length ? group : [key]).filter(Boolean);
  const resolvedIdx = Number.isFinite(groupIndex) && groupIndex >= 0 ? groupIndex : cards.indexOf(key);
  let currentIndex = Math.min(Math.max(0, resolvedIdx < 0 ? 0 : resolvedIdx), cards.length - 1);
  
  const ov = openOverlay('expand', { onScrim: (o) => o.close(), testid: 'expanded' });
  
  // Container for all card frames (for swipe animation)
  const cardTrack = h('div', { class: 'card-track', 'data-testid': 'card-track' });
  const cardinfoContainer = h('div', { class: 'cardinfo-container', 'data-testid': 'cardinfo-container' });
  const actionsContainer = h('div', { class: 'actions-container', 'data-testid': 'expanded-actions' });
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
    }, h('img', { class: 'big', src: art(k), alt: k, 'data-testid': 'expanded-img' }));
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
    replaceChildren(cardinfoContainer, cardInfo(g, k));

    const actBtn = (a) => {
      const sub = a.sub == null ? null : (Array.isArray(a.sub) ? h('span', { class: 'sub' }, ...a.sub) : h('span', { class: 'sub' }, a.sub));
      return h('button', {
        class: `act ${a.cls || ''}`, disabled: a.disabled || null, 'data-testid': a.testid,
        onclick: async (e) => { e.stopPropagation(); g.sfx('tap'); const keep = await a.onClick(ov); if (!keep) ov.close(); },
      }, h('span', {}, a.label), sub);
    };

    // Update actions (function form refreshes per swipe target)
    const acts = typeof actions === 'function' ? actions(k, idx) : actions;
    replaceChildren(actionsContainer);
    if (acts?.length) {
      const row = h('div', { class: 'actions' });
      acts.forEach((a) => appendNodes(row, actBtn(a)));
      replaceChildren(actionsContainer, row);
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
    let startX = 0, startY = 0, currentX = 0, currentY = 0, isDragging = false, hasMoved = false;
    const threshold = 50; // minimum swipe distance
    const verticalThreshold = 30; // max vertical movement to still count as horizontal swipe
    
    const onStart = (x, y) => {
      startX = x; startY = y; currentX = x; isDragging = true; hasMoved = false;
    };
    
    const onMove = (x, y) => {
      if (!isDragging) return;
      const deltaX = x - startX;
      const deltaY = y - startY;
      
      // Check if this is a vertical scroll (let it through)
      if (!hasMoved && Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
        isDragging = false;
        return;
      }
      
      hasMoved = true;
      currentX = x;
      currentY = y;
      
      // Apply transform to current card frame with rubber-band at edges
      const frames = cardTrack.querySelectorAll('.big-frame');
      const activeFrame = Array.from(frames).find(f => parseInt(f.dataset.index) === currentIndex);
      if (activeFrame) {
        let translateX = deltaX;
        // Rubber-band effect at edges
        if ((currentIndex === 0 && deltaX > 0) || (currentIndex === cards.length - 1 && deltaX < 0)) {
          translateX = deltaX * 0.3; // reduced movement at bounds
        }
        activeFrame.style.transition = 'none';
        activeFrame.style.transform = `translateX(${translateX}px)`;
      }
    };
    
    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      
      const deltaX = currentX - startX;
      const deltaY = Math.abs(currentY - startY);
      
      // Only swipe if horizontal movement dominates and exceeds threshold
      if (hasMoved && Math.abs(deltaX) > threshold && Math.abs(deltaX) > deltaY) {
        if (deltaX > 0 && currentIndex > 0) {
          navigateTo(currentIndex - 1); // swipe right = previous
        } else if (deltaX < 0 && currentIndex < cards.length - 1) {
          navigateTo(currentIndex + 1); // swipe left = next
        } else {
          updateContent(currentIndex); // snap back
        }
      } else {
        updateContent(currentIndex); // snap back
      }
    };
    
    // Touch events
    cardTrack.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      onStart(touch.clientX, touch.clientY);
    }, { passive: true });
    
    cardTrack.addEventListener('touchmove', (e) => {
      if (isDragging) {
        const touch = e.touches[0];
        onMove(touch.clientX, touch.clientY);
      }
    }, { passive: true });
    
    cardTrack.addEventListener('touchend', onEnd, { passive: true });
    cardTrack.addEventListener('touchcancel', onEnd, { passive: true });
    
    // Mouse events for desktop
    cardTrack.addEventListener('mousedown', (e) => {
      onStart(e.clientX, e.clientY);
      e.preventDefault();
    });
    
    cardTrack.addEventListener('mousemove', (e) => {
      if (isDragging) {
        onMove(e.clientX, e.clientY);
        e.preventDefault();
      }
    });
    
    cardTrack.addEventListener('mouseup', onEnd);
    cardTrack.addEventListener('mouseleave', onEnd);
    
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
  
  const titleEl = title ? h('div', { class: 'ov-title', 'data-testid': titleTestid || 'expand-title' }, title) : null;
  appendNodes(scrollInner, titleEl, cardTrack, indicator, actionsContainer, cardinfoContainer);
  appendNodes(ov.el, closeBtn(() => ov.close()), prevBtn, nextBtn, scrollInner);

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
    const tag = p.you ? 'You' : (p.human ? 'Human' : `AI ${p.level ? p.level[0].toUpperCase() + p.level.slice(1) : ''}${p.profile ? ' · ' + p.profile : ''}`);
    const tok = counts(p.tok);
    const pairs = pairUp(g, p.wizards, p.towers);
    appendNodes(ov.el, h('div', { class: `mat ${p.you ? 'you' : ''}`, 'data-testid': `mat-${p.name}` },
      h('div', { class: 'mat-head' }, avatar(p.name, 30), h('span', { class: 'mat-name' }, p.name), h('span', { class: `mat-tag ${p.you ? 'you' : ''}` }, tag),
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
    appendNodes(list, h('div', { class: 'log-item', 'data-testid': 'log-item' },
      h('span', { class: 'dot', style: { background: DOT[e.who] || '#9aa6cc' } }),
      h('div', { style: { flex: 1 } }, h('div', {}, e.text),
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

function xTargetPicker(g, host, maxX, title = 'Invisibility Potion') {
  const [p, done] = wait();
  let x = 1; let target = null;
  const val = h('span', { class: 'val' }, '1');
  const opp = g.v.players.filter((q) => !q.you);
  const go = h('button', { class: 'act', disabled: true, 'data-testid': 'x-confirm' }, 'Cast');
  const chips = opp.map((q) => {
    const c = h('button', { class: 'chip', 'data-testid': `x-target-${q.name}` }, avatar(q.name, 26), `${q.name} · ${q.gold ?? '?'} Gold`);
    c.onclick = () => { target = q.name; chips.forEach((z) => z.classList.remove('on')); c.classList.add('on'); go.disabled = false; };
    return c;
  });
  appendNodes(host, h('div', { class: 'phase-title' }, `${title}: pay X Eye of Newt`),
    h('div', { class: 'stepper' }, h('button', { onclick: () => { x = Math.max(1, x - 1); val.textContent = x; } }, '−'), val, h('button', { onclick: () => { x = Math.min(maxX, x + 1); val.textContent = x; } }, '+')),
    h('div', { class: 'chips' }, chips), h('div', { class: 'actions' }, go));
  go.onclick = () => done({ x, target });
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
  const body = h('div', { style: { display: 'contents' } });
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
  const famGroup = (group && group.length ? group : (g.v.board.fam_face || []).filter(Boolean));
  const resolvedIdx = Number.isFinite(groupIndex) && groupIndex >= 0 ? groupIndex : famGroup.indexOf(fk);
  const startIdx = resolvedIdx < 0 ? 0 : resolvedIdx;
  expandCard(g, fk, {
    group: famGroup,
    groupIndex: startIdx,
    actions: (k) => {
      const L = (g.v.legal.summon || {})[k];
      if (!L) return [];
      const uses = new Set(L.uses);
      const act = (use) => async (overlay) => {
        if (use === 'gather') {
          overlay.close();
          await summonGather(g, k);
          return true;
        }
        return commitFromExpand(g, overlay, async () => {
          const from = slotRectOf(k);
          const r = await g.act('act_summon', { familiar: k, use }, { sound: use === 'score' ? 'coin' : 'select' });
          if (r) {
            const hit = (r.entries || []).find((e) => e.act === 'summon' && e.feedback);
            if (hit?.feedback) g.toast(hit.feedback);
            fly(art(k), from, dockTarget());
          }
          return r;
        });
      };
      const scoreSub = L.powerful_helper
        ? `${L.cost} mana · +${L.score_gold} Gold (+${L.powerful_helper} Powerful Helper)`
        : `${L.cost} mana · +${L.score_gold} Gold`;
      return [
        { label: 'Summon to Score', sub: scoreSub, testid: 'summon-score', disabled: !uses.has('score'), onClick: act('score') },
        { label: 'Summon to Gather', sub: [`${L.cost} mana · `, ...Array.from({ length: L.collect }, () => h('img', { src: reagentIcon(L.reagent), alt: '' }))], testid: 'summon-gather', disabled: !uses.has('gather'), onClick: act('gather') },
        { label: 'Enter the Dungeon', sub: `${L.cost} mana`, testid: 'summon-dungeon', disabled: !uses.has('dungeon'), onClick: act('dungeon') },
        { label: 'New Research', sub: `${L.cost} mana`, testid: 'summon-research', disabled: !uses.has('research'), onClick: act('research') },
      ];
    },
  });
}

async function summonGather(g, fk) {
  const ov = openOverlay('gather', { testid: 'summon-gather-flow' });
  const body = h('div', { style: { display: 'contents' } });
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
        { label: 'Research', sub: `${L.mana} mana`, testid: 'research-only', onClick: (overlay) => commitFromExpand(g, overlay, async () => {
          const from = slotRectOf(k);
          const r = await g.act('act_research', { spell: k, cast: false }, { sound: 'select' });
          if (r) fly(art(k), from, dockTarget());
          return r;
        }) },
        { label: 'Research & Cast', sub: [`${L.mana} mana + `, ...costIcons(cost), L.x ? '×X' : ''], testid: 'research-cast', disabled: !L.castable, onClick: async (overlay) => {
          let x = null, target = null;
          if (L.x) {
            overlay.el.innerHTML = ''; overlay.el.classList.add('gather');
            const eyes = g.me_().tok.filter((t) => t === 'Eye_of_Newt').length;
            const xt = await xTargetPicker(g, overlay.el, eyes); x = xt.x; target = xt.target;
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
        buildLegal.reagent ? { label: 'Build with reagents', sub: costIcons(Array.from({ length: buildLegal.reagent.n }, () => buildLegal.reagent.reagent)), testid: 'build-reagent', onClick: build('reagent') } : null,
        buildLegal.gold ? { label: 'Build with Gold', sub: `${buildLegal.gold.n} Gold`, testid: 'build-gold', onClick: build('gold') } : null,
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
  const val2 = h('span', { class: 'val', 'data-testid': 'convert-n2' }, '1');
  const gain = h('div', { class: 'gain' });
  const gain2 = h('div', { class: 'gain', 'data-testid': 'convert-gain2' });
  const secondRow = h('div', { class: 'stepper adept-stepper', style: { display: 'none' }, 'data-testid': 'convert-stepper2' });
  const xQueued = h('div', { class: 'chips', 'data-testid': 'transform-queue' });
  const xPick = h('div', { class: 'chips' });
  const xAdd = h('button', { class: 'chip', disabled: true, 'data-testid': 'transform-add' }, 'Transform (2:1)');
  const trackOf = (r) => (g.v.board.tracks[r] ?? 0);
  const rebuildSecondStepper = () => {
    secondRow.style.display = r2 ? 'flex' : 'none';
    secondRow.innerHTML = '';
    if (!r2) return;
    const c2 = L.convert[r2];
    n2 = Math.min(c2.n, Math.max(1, n2));
    appendNodes(secondRow, 
      h('button', { 'data-testid': 'convert-minus2', onclick: () => { n2 = Math.max(1, n2 - 1); upd(); g.sfx('tap'); } }, '−'), val2,
      h('button', { 'data-testid': 'convert-plus2', onclick: () => { n2 = Math.min(c2.n, n2 + 1); upd(); g.sfx('tap'); } }, '+'),
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
  const xTarget = h('select', { 'data-testid': 'transform-target' }, ...REAGENTS.map((r) => h('option', { value: r }, nice(r))));
  xTarget.value = reagent;
  xTarget.onchange = () => { g.sfx('select'); };
  xAdd.onclick = () => {
    if (xSel.size !== 2) return;
    const vt = virtualTok();
    const fr = [...xSel].sort((a, b) => a - b).map((i) => vt[i]);
    transforms.push({ from: fr, to: xTarget.value });
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
    n = Math.min(n, countTok(reagent) || 1);
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
          `${n} × ${v} = `, h('b', {}, `+${n * v} mana`), ` · track ends at ${endTrack}`));
    } else {
      appendNodes(gain, h('div', { 'data-testid': 'convert-gain-math' },
        `${n} × ${v} = `, h('b', {}, `+${n * v} mana`), ` · track ${v} → ${endTrack}`));
    }
    if (adept && r2) {
      const c2 = L.convert[r2] || { n: countTok(r2), value: trackOf(r2) };
      n2 = Math.min(Math.max(1, n2), countTok(r2));
      val2.textContent = String(n2);
      const tv = trackOf(r2);
      gain2.innerHTML = '';
      appendNodes(gain2, `${n2} × ${tv} = `, h('b', {}, `+${n2 * tv} mana`), ` · track ${tv} → ${Math.max(1, tv - n2)}`);
    } else {
      gain2.innerHTML = '';
      val2.textContent = '1';
      n2 = 1;
    }
  };
  let type2Sel = null;
  if (adept) {
    type2Sel = h('select', { id: 'convert-adept-type2', 'data-testid': 'convert-adept-type2' },
      h('option', { value: '' }, '— optional —'),
      ...otherTypes.map((r) => h('option', { value: r }, nice(r))));
    type2Sel.onchange = () => {
      r2 = type2Sel.value;
      rebuildSecondStepper();
      upd();
      g.sfx('tap');
    };
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
    transformOn ? h('div', { class: 'transform-block', 'data-testid': 'convert-transform' },
      h('div', { class: 'ov-sub' }, 'Transform (2:1): pick any 2 tokens, then one target type (repeatable before selling).'),
      xPick,
      h('label', { class: 'sr-only', for: 'transform-target' }, 'Transform into'),
      xTarget,
      xAdd,
      xQueued) : null,
    adept ? h('div', { class: 'ov-sub', 'data-testid': 'convert-adept-banner' }, 'Adept Conversion: you may sell a second type in this same action (below).') : null,
    h('div', { class: 'stepper' }, h('button', { 'data-testid': 'convert-minus', onclick: () => { n = Math.max(1, n - 1); upd(); g.sfx('tap'); } }, '−'), val,
      h('button', { 'data-testid': 'convert-plus', onclick: () => { n = Math.min(countTok(reagent), n + 1); upd(); g.sfx('tap'); } }, '+')),
    gain,
    adept ? h('div', { class: 'adept-second' },
      h('div', { class: 'ov-sub', 'data-testid': 'convert-adept-note' }, 'Adept Conversion: convert a 2nd type'),
      h('label', { class: 'sr-only', for: 'convert-adept-type2' }, 'Second reagent type'),
      type2Sel,
      secondRow) : null,
    adept ? gain2 : null,
    h('div', { class: 'actions' }, h('button', { class: 'act', 'data-testid': 'convert-go', onclick: onGo }, 'Convert')),
    L.convert1 ? h('button', { class: 'linkish', 'data-testid': 'convert-mixed', onclick: () => { ov.close(); convertMixed(g); } }, 'Sell a mix of reagents at 1 mana each') : null);
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
    b.onclick = () => { if (sel.has(i)) { sel.delete(i); b.classList.remove('on'); } else { sel.add(i); b.classList.add('on'); } go.disabled = !sel.size; go.textContent = `Sell ${sel.size} for ${sel.size} mana`; };
    return b;
  }));
  go.onclick = async () => { const r = await g.act('act_convert1', { reagents: [...sel].map((i) => me.tok[i]) }, { sound: 'coin' }); ov.close(); if (r) g.afterAction(); };
  appendNodes(ov.el, h('div', { class: 'sheet-panel' }, h('div', { class: 'phase-title' }, 'Sell any mix at 1 mana each'), grid, h('div', { class: 'actions' }, go)));
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
    appendNodes(grid, ...opts.map((o) => h('button', { class: 'chip', 'data-testid': `school-${o.school}`, onclick: pick(o) }, h('img', { src: schoolIcon(o.school), alt: '' }), `${o.school} · +${o.gold} Gold`)));
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
    appendNodes(grid, ...tok.map((r, i) => { const b = h('button', { class: 'tokbtn', 'data-testid': `transmute-${i}` }, h('img', { src: reagentIcon(r), alt: '' })); b.onclick = () => { if (sel.has(i)) { sel.delete(i); b.classList.remove('on'); } else { sel.add(i); b.classList.add('on'); } go.disabled = sel.size < 2 || sel.size % 2; go.textContent = `Transmute ${sel.size} → ${Math.floor(sel.size / 2)} Gold`; }; return b; }));
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
  appendNodes(ov.el, h('div', { class: 'opt-grid' }, pd.four.map((k) => h('button', { class: 'opt-card wide', 'data-testid': `nr-${k}`, onclick: () => done(k) },
    h('img', { src: art(k), alt: k }), h('span', { class: 'oc-text' }, g.cards[k]?.display), h('span', { class: 'oc-label' }, g.cards[k]?.effect)))));
  const k = await p;
  const r = await g.act('choose_new_research', { spell: k }, { sound: 'select' });
  ov.close();
  return r;
}

export async function riseUseChooser(g) {
  const pd = g.v.pending;
  const ov = openOverlay('gather', { testid: 'rise-use' });
  const [p, done] = wait();
  appendNodes(ov.el, h('div', { class: 'chooser-head' }, h('img', { src: art(pd.familiar), alt: '' }),
    h('div', {}, h('div', { class: 'phase-title' }, 'Rise'), h('div', { class: 'ov-sub' }, 'Use this familiar'))));
  const uses = [
    { use: 'score', label: `Score: +${pd.score_gold} Gold`, testid: 'rise-score' },
    { use: 'gather', label: `Gather: ${pd.collect} ${nice(pd.reagent)}`, testid: 'rise-gather' },
    { use: 'dungeon', label: 'Enter the Dungeon', testid: 'rise-dungeon' },
    { use: 'research', label: 'New Research', testid: 'rise-research' }
  ];
  appendNodes(ov.el, h('div', { class: 'opt-grid' }, uses.map((u) => h('button', { class: 'chip', 'data-testid': u.testid, onclick: () => done(u.use) }, u.label))));
  const use = await p;
  ov.close();
  if (use === 'score') {
    const r = await g.act('rise_use', { use }, { sound: 'coin' });
    return r;
  } else if (use === 'gather') {
    return riseGather(g, pd);
  } else if (use === 'dungeon') {
    const r = await g.act('rise_use', { use: 'dungeon' });
    if (r) await dungeonFlow(g);
    return r;
  } else if (use === 'research') {
    const r = await g.act('rise_use', { use: 'research' });
    if (r) await newResearchChooser(g);
    return r;
  }
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
        appendNodes(ov.el, h('div', { class: 'ov-title' }, 'The Dungeon'), h('div', { class: 'result good', 'data-testid': 'dungeon-result' }, `Collected ${gold} Gold${items.length ? ' + ' + items.join(', ') : ''}`), loot);
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
    const s = h('div', { class: 'seat', 'data-testid': `seat-${n}`, style: { left: `${x}%`, top: y < 50 ? `max(48px, ${y}%)` : `${y}%` } }, avatar(n, 44), h('div', { class: 'sname' }, n), b);
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
    const mana = h('div', { class: 'bid-mana', 'data-testid': 'bid-mana' }, `Your mana: ${max}`, opening ? '' : ` · high bid ${min - 1}${lead ? ` (${lead})` : ''}`);
    if (min === max) {
      // A range input with min == max is degenerate (iOS Safari lets the thumb report values outside it): offer the one bid.
      out.firstChild.textContent = String(val);
      appendNodes(bar, out, mana, h('div', { class: 'ov-sub', style: { margin: 0 } }, `${val} is all your mana`), h('div', { class: 'bidbtns' }, passBtn, bidBtn));
      return p;
    }
    const sl = h('input', { type: 'range', class: 'slider', min, max, value: val, step: 1, 'data-testid': 'bid-slider' });
    const show = () => { sl.value = val; out.firstChild.textContent = String(val); };
    sl.oninput = () => { val = clamp(sl.value); show(); };
    const step = (d) => () => { val = clamp(val + d); show(); g.sfx('tap'); };
    appendNodes(bar, out, mana, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
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
      msg.textContent = `${w === me ? 'You win' : w + ' wins'} ${g.cards[card]?.name || ''} for ${e.price} mana`;
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
      h('div', { 'data-testid': 'ai-banner-text' }, e.text), extra,
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
      h('button', { class: 'act', 'data-testid': 'go-new-game', onclick: () => { ov.close(); newGame(g); } }, 'Play again'),
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
      h('button', { class: v.game_over ? 'act' : 'act secondary', 'data-testid': 'menu-new-game', onclick: () => { ov.close(); newGame(g); } }, v.game_over ? 'Play again (new game)' : 'New game'),
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

// New game: Keith, Newt (AI) and LizWiz (AI), dealt by the engine's setup script; Keith picks 2 starting reagents.
export async function newGame(g) {
  const ov = openOverlay('gather newgame', { testid: 'new-game' });
  appendNodes(ov.el, closeBtn(() => ov.close(), 'new-game-cancel'), h('div', { class: 'ov-title' }, 'New game'), h('div', { class: 'ov-sub' }, 'Dealing…'));
  const seeds = g.nextGameSeeds || {};          // tests seed the deal for reproducible playthroughs
  const pr = await g.call('new_game_preview', { seed: seeds.seed, ai_seed: seeds.ai_seed });
  if (ov.closed) return;
  if (!pr.ok) { g.toast(pr.error); ov.close(); return; }
  const { hand, reagents, players } = pr.result;
  const picks = [];
  const start = h('button', { class: 'act', disabled: true, 'data-testid': 'new-game-start' }, 'Start game');
  const chips = reagents.map((r) => {
    const c = h('button', { class: 'chip', 'data-testid': `pick-${r}` }, h('img', { src: reagentIcon(r), alt: '' }), nice(r));
    c.onclick = () => {
      const i = picks.indexOf(r);
      if (i >= 0) { picks.splice(i, 1); c.classList.remove('on'); g.sfx('unselect'); }
      else if (picks.length < 2) { picks.push(r); c.classList.add('on'); g.sfx('select'); }
      start.disabled = picks.length !== 2;
    };
    return c;
  });
  ov.el.innerHTML = '';
  appendNodes(ov.el, closeBtn(() => ov.close(), 'new-game-cancel'), h('div', { class: 'ov-title' }, 'New game'),
    h('div', { class: 'ov-sub' }, `${players.join(', ')} · you start. This replaces the current game (export it first to keep it).`),
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
