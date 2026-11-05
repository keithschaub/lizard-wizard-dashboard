import { h, art, reagentIcon, schoolIcon, nice, REAGENTS, counts, avatar, tokenChip, costIcons, sleep } from './dom.js';

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
  window.addEventListener('resize', update);
  requestAnimationFrame(update);
}
export function closeAll() { document.querySelectorAll('#overlays .overlay').forEach((o) => o.remove()); }

function closeBtn(fn, testid = 'ov-close') { return h('button', { class: 'ov-close', 'aria-label': 'Close', 'data-testid': testid, onclick: (e) => { e.stopPropagation(); fn(); } }, '×'); }
const wait = () => { let res; const p = new Promise((r) => { res = r; }); return [p, res]; };

// Card art flying from one place to another (auction win, loot to the mat, builds).
export function fly(src, from, toEl, { w = 54, hgt = 76 } = {}) {
  if (!from || !toEl) return;
  const to = toEl.getBoundingClientRect();
  const img = h('img', { class: 'fly', src, alt: '', style: { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` } });
  document.body.append(img);
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
  if (c.school) meta.push(h('span', {}, c.school !== 'Wild' ? h('img', { src: schoolIcon(c.school), alt: '' }) : null, ` ${c.school}`));
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
  if (c.deck === 'Familiar' && c.effect) text = c.effect.split('||').map((part) => h('div', {}, part.trim().replace(' | ', ' · ')));
  else if (c.deck === 'Reagent') text = [h('div', {}, 'Gather: ', ...costIcons(c.gather_icons || [])), h('div', {}, 'Increase Value: ', ...costIcons(c.increase_icons || []))];
  else text = c.effect || '';
  return h('div', { class: 'cardinfo', 'data-testid': 'card-info' },
    h('div', { class: 'ci-name' }, c.display || c.name || key),
    meta.length ? h('div', { class: 'ci-meta' }, meta) : null,
    text ? h('div', { class: 'ci-text', 'data-testid': 'card-text' }, text) : null);
}

export function expandCard(g, key, { actions = [], extra = null } = {}) {
  const ov = openOverlay('expand', { onScrim: (o) => o.close(), testid: 'expanded' });
  const isAch = key.startsWith('Achievement:');
  // The scans are trimmed right at the medallion/title, so the card sits in a dark frame that gives its top edge room.
  const img = isAch ? null : h('div', { class: 'big-frame', 'data-testid': 'expanded-card', onclick: () => ov.close() },
    h('img', { class: 'big', src: art(key), alt: key, 'data-testid': 'expanded-img' }));
  ov.el.append(closeBtn(() => ov.close()), img, cardInfo(g, key));
  if (extra) ov.el.append(extra);
  if (actions.length) {
    ov.el.append(h('div', { class: 'actions' }, actions.map((a) => h('button', {
      class: `act ${a.cls || ''}`, disabled: a.disabled || null, 'data-testid': a.testid,
      onclick: async (e) => { e.stopPropagation(); g.sfx('tap'); const keep = await a.onClick(ov); if (!keep) ov.close(); },
    }, h('span', {}, a.label), a.sub ? h('span', { class: 'sub' }, a.sub) : null))));
  }
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

function mini(g, key, { cls = '', badge = null, testid = null } = {}) {
  if (!key) return h('div', { class: 'mcard back', 'data-testid': testid }, 'LW');
  return h('div', { class: `mcard ${cls}`, 'data-testid': testid, onclick: (e) => { e.stopPropagation(); g.sfx('tap'); expandCard(g, key); } },
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
  ov.el.append(closeBtn(() => ov.close()));
  const v = g.v;
  const order = [...v.players].sort((a, b) => (b.you - a.you) || v.seat_order.indexOf(a.name) - v.seat_order.indexOf(b.name));
  console.info('[mats]', order.map((p) => `${p.name}: wizards [${p.wizards.join(', ')}] towers [${p.towers.join(', ')}]`).join(' | '));
  for (const p of order) {
    const tag = p.you ? 'You' : (p.human ? 'Human' : `AI ${p.level ? p.level[0].toUpperCase() + p.level.slice(1) : ''}${p.profile ? ' · ' + p.profile : ''}`);
    const tok = counts(p.tok);
    const pairs = pairUp(g, p.wizards, p.towers);
    ov.el.append(h('div', { class: `mat ${p.you ? 'you' : ''}`, 'data-testid': `mat-${p.name}` },
      h('div', { class: 'mat-head' }, avatar(p.name, 30), h('span', { class: 'mat-name' }, p.name), h('span', { class: `mat-tag ${p.you ? 'you' : ''}` }, tag),
        h('span', { class: 'stat vp mat-vp' }, `${p.vp} VP`)),
      h('div', { class: 'mat-row' },
        h('span', { class: 'stat mana' }, h('span', { class: 'orb' }), p.mana === null ? '?' : p.mana),
        h('span', { class: 'stat gold' }, h('span', { class: 'orb' }), p.gold === null ? '?' : p.gold),
        h('span', { class: `stat store ${p.tok.length >= p.cap ? 'full' : ''}` }, `Reagents ${p.tok.length}/${p.cap}`),
        h('span', { class: 'stat store' }, `Gather 3${p.bonus.length ? ' +' + p.bonus.length : ''}`, ...p.bonus.map((r) => h('img', { src: reagentIcon(r), alt: '', style: { width: '18px' } })))),
      h('div', { class: 'mat-row' }, tok.size ? [...tok].map(([r, n]) => tokenChip(r, n)) : h('span', { class: 'none' }, 'No reagent tokens')),
      h('div', { class: 'mat-label' }, p.you ? 'Reagent cards in hand' : `Reagent cards in hand: ${p.hand_count}`),
      p.you ? h('div', { class: 'mat-row' }, p.hand.map((k) => mini(g, k))) : null,
      h('div', { class: 'mat-label' }, `Wizards & Towers (${p.wizards.length}/${p.towers.length})`),
      h('div', { class: 'mat-row' }, pairs.length ? pairs.map(([w, t, m]) => h('div', { class: `pair ${m ? 'match' : ''}` },
        h('span', { class: 'pts' }, m ? '+10' : (w && t ? '+5' : '+1')), w ? mini(g, w) : h('div', { class: 'mcard empty' }, 'no wizard'), t ? mini(g, t) : h('div', { class: 'mcard empty' }, 'no tower')))
        : h('span', { class: 'none' }, 'None yet')),
      h('div', { class: 'mat-cardlist', 'data-testid': `mat-cards-${p.name}`, 'data-wizards': p.wizards.join(','), 'data-towers': p.towers.join(',') },
        `Wizards: ${cardList(g, p.wizards)} · Towers: ${cardList(g, p.towers)}`),
      h('div', { class: 'mat-label' }, `Spells & Familiars (${p.spells.length + p.familiars.length})`),
      h('div', { class: 'mat-row' }, (p.spells.length + p.familiars.length) ? [
        ...p.spells.map((s) => s.key ? mini(g, s.key, { cls: s.cast ? '' : 'uncast', badge: s.cast ? null : 'uncast' }) : mini(g, null)),
        ...p.familiars.map((f) => mini(g, f)),
      ] : h('span', { class: 'none' }, 'None yet')),
      (p.treasures.length || p.achievements.length) ? h('div', { class: 'mat-label' }, 'Items & Achievements') : null,
      (p.treasures.length || p.achievements.length) ? h('div', { class: 'mat-row' },
        ...p.treasures.map((t) => mini(g, t.key)), ...p.achievements.map((a) => h('span', { class: 'chip static' }, `🏆 ${a}`))) : null,
    ));
  }
  return ov;
}

// ------------------------------------------------------------------ log drawer
const DOT = { Keith: '#6ff0d0', Newt: '#c49bff', LizWiz: '#ffb46b' };
export async function openLog(g) {
  const ov = openOverlay('drawer', { onScrim: (o) => o.close(), testid: 'log' });
  const list = h('div', { class: 'log-list', 'data-testid': 'log-list' }, h('div', { class: 'none' }, 'Reading the chronicle…'));
  ov.el.append(h('div', { class: 'drawer-panel' }, h('div', { class: 'drawer-head' }, h('span', { class: 'ttl' }, 'Chronicle'), closeBtn(() => ov.close(), 'log-close')), list));
  const r = await g.call('full_log');
  list.innerHTML = '';
  let round = null;
  for (const e of r.result || []) {
    if (e.act === 'turn') continue;
    if (e.r !== round) { round = e.r; list.append(h('div', { class: 'log-round' }, e.r ? `Round ${e.r}` : 'Setup')); }
    const thumbs = (e.cards || []).filter((k) => k && g.cards[k] && k !== e.cast);
    const castBlock = e.cast && g.cards[e.cast] ? h('div', { class: 'log-cast', 'data-testid': 'log-cast' },
      h('img', { src: art(e.cast), alt: e.cast, onclick: () => expandCard(g, e.cast) }),
      h('div', {}, h('div', { class: 'lc-name' }, g.cards[e.cast].display), h('div', { class: 'lc-text' }, g.cards[e.cast].effect))) : null;
    list.append(h('div', { class: 'log-item', 'data-testid': 'log-item' },
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
    grid.append(b);
  });
  host.append(h('div', { class: 'phase-title' }, 'Storage full — put back reagents'),
    h('div', { class: 'counter' }, 'Put back', counter), grid);
  return p;
}

function castPicker(g, host, castable, { multi = false, title = 'Cast a spell with this gather?' } = {}) {
  const [p, done] = wait();
  const chosen = new Set();
  host.append(h('div', { class: 'phase-title' }, title));
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
    row.append(el);
  }
  host.append(row);
  host.append(h('div', { class: 'actions' }, h('button', { class: 'act secondary', 'data-testid': 'skip-cast', onclick: () => done({ skip: true }) }, multi ? 'Done casting' : 'Skip cast')));
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
  host.append(h('div', { class: 'phase-title' }, `${title}: pay X Eye of Newt`),
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
  ov.el.append(closeBtn(() => ov.close(), 'gather-cancel'), body);

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
        wrap.append(h('button', {
          class: `hot ${on ? 'on' : 'live'}`, 'data-testid': `hot-${sd}-${i}`, 'data-reagent': r, 'aria-label': nice(r),
          style: { left: `${x * 100}%`, top: `${(y0 + y * (y1 - y0)) * 100}%` },
          onclick: () => tapIcon(sd, i),
        }));
      });
    }
    if (L.miracle) wrap.append(h('span', { class: 'half-tag', style: { top: '57%', background: 'rgba(90,162,255,.85)' } }, 'Miracle: may gather this side'));
    body.append(wrap);
    body.append(h('div', { class: 'counter' }, 'Keep', h('span', { class: 'pill', 'data-testid': 'keep-counter' }, `${sel.size} / ${need(side)}`)));
    if (L.bonus.length) body.append(h('div', { class: 'chips' }, L.bonus.map((r) => h('span', { class: 'chip static' }, h('img', { src: reagentIcon(r), alt: '' }), '+1 wizard bonus'))));
    if (L.bloom) {
      body.append(h('div', { class: 'phase-title', style: { fontSize: '15px' } }, 'Bloom: +1 any reagent'),
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
      body.append(h('img', { class: 'mini-card', src: art(cid), alt: '' }),
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
      body.append(h('img', { class: 'mini-card', src: art(cid), alt: '' }));
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
export function summonFlow(g, fk) {
  const L = g.v.legal.summon[fk];
  const uses = new Set(L.uses);
  const act = (use) => async () => {
    if (use === 'gather') { await summonGather(g, fk); return; }
    const from = slotRectOf(fk);
    const r = await g.act('act_summon', { familiar: fk, use }, { sound: use === 'score' ? 'coin' : 'select' });
    if (r) { fly(art(fk), from, dockTarget()); g.afterAction(); }
  };
  expandCard(g, fk, { actions: [
    { label: `Summon to Score`, sub: `${L.cost} mana · +${L.score_gold} Gold`, testid: 'summon-score', disabled: !uses.has('score'), onClick: act('score') },
    { label: `Summon to Gather`, sub: [`${L.cost} mana · `, ...Array.from({ length: L.collect }, () => h('img', { src: reagentIcon(L.reagent), alt: '' }))], testid: 'summon-gather', disabled: !uses.has('gather'), onClick: act('gather') },
    { label: 'Enter the Dungeon', sub: `${L.cost} mana`, testid: 'summon-dungeon', disabled: !uses.has('dungeon'), onClick: act('dungeon') },
    { label: 'New Research', sub: `${L.cost} mana`, testid: 'summon-research', disabled: !uses.has('research'), onClick: act('research') },
  ] });
}

async function summonGather(g, fk) {
  const ov = openOverlay('gather', { testid: 'summon-gather-flow' });
  const body = h('div', { style: { display: 'contents' } });
  ov.el.append(closeBtn(() => ov.close(), 'gather-cancel'), body);
  let casts = [];
  for (;;) {
    const pr = await g.call('summon_gather_preview', { familiar: fk, casts });
    if (!pr.ok) { g.toast(pr.error); ov.close(); return; }
    const pv = pr.result;
    if (!pv.castable.length && !casts.length) break;
    body.innerHTML = '';
    body.append(h('img', { class: 'mini-card', src: art(fk), alt: '' }), h('div', { class: 'chips' }, pv.got.map((r) => h('span', { class: 'chip static glow' }, h('img', { src: reagentIcon(r), alt: '' }), nice(r)))));
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

export function researchFlow(g, sk) {
  const L = g.v.legal.research[sk];
  const cost = Object.entries(g.cards[sk]?.cost?.reagents || {}).flatMap(([r, n]) => (n === 'X' ? [r] : Array.from({ length: n }, () => r)));
  expandCard(g, sk, { actions: [
    { label: 'Research', sub: `${L.mana} mana`, testid: 'research-only', onClick: async () => { const from = slotRectOf(sk); const r = await g.act('act_research', { spell: sk, cast: false }, { sound: 'select' }); if (r) { fly(art(sk), from, dockTarget()); g.afterAction(); } } },
    { label: 'Research & Cast', sub: [`${L.mana} mana + `, ...costIcons(cost), L.x ? '×X' : ''], testid: 'research-cast', disabled: !L.castable, onClick: async (ov) => {
      let x = null, target = null;
      if (L.x) {
        ov.el.innerHTML = ''; ov.el.classList.add('gather');
        const eyes = g.me_().tok.filter((t) => t === 'Eye_of_Newt').length;
        const xt = await xTargetPicker(g, ov.el, eyes); x = xt.x; target = xt.target;
      }
      const from = slotRectOf(sk);
      const r = await g.act('act_research', { spell: sk, cast: true, x, target }, { sound: 'cast' });
      if (r) { fly(art(sk), from, dockTarget()); g.afterAction(); }
    } },
  ] });
}

export function buildFlow(g) {
  const B = g.v.legal.build;
  const build = async (pay) => {
    const from = slotRectOf(B.tower);
    const r = await g.act('act_build', { pay }, { sound: 'build' });
    if (r) { fly(art(B.tower), from, dockTarget()); g.afterAction(); }
  };
  expandCard(g, B.tower, { actions: [
    B.reagent ? { label: 'Build with reagents', sub: costIcons(Array.from({ length: B.reagent.n }, () => B.reagent.reagent)), testid: 'build-reagent', onClick: () => build('reagent') } : null,
    B.gold ? { label: 'Build with Gold', sub: `${B.gold.n} Gold`, testid: 'build-gold', onClick: () => build('gold') } : null,
  ].filter(Boolean) });
}

export function divinationFlow(g) {
  expandCard(g, 'Spell_Divination', { actions: [
    { label: 'Enter the Dungeon', sub: 'Divination', testid: 'divination-enter', onClick: async () => { const r = await g.act('act_divination', {}, { sound: 'select' }); if (r) g.afterAction(); } },
  ] });
}

export function convertSheet(g, reagent) {
  const L = g.v.legal;
  const c = L.convert[reagent]; let n = c.n; let energize = false;
  const ov = openOverlay('sheet', { onScrim: (o) => o.close(), testid: 'convert' });
  const val = h('span', { class: 'val', 'data-testid': 'convert-n' }, String(n));
  const gain = h('div', { class: 'gain' });
  const upd = () => {
    const v = Math.min(12, c.value + (energize ? 3 : 0));
    val.textContent = n;
    gain.innerHTML = ''; gain.append(`${n} × ${v} = `, h('b', {}, `+${n * v} mana`), ` · track ${v} → ${Math.max(1, v - n)}`);
  };
  const panel = h('div', { class: 'sheet-panel' },
    h('img', { class: 'big-icon', src: reagentIcon(reagent), alt: '' }),
    h('div', { class: 'phase-title' }, `Convert ${nice(reagent)}`),
    h('div', { class: 'stepper' }, h('button', { 'data-testid': 'convert-minus', onclick: () => { n = Math.max(1, n - 1); upd(); g.sfx('tap'); } }, '−'), val,
      h('button', { 'data-testid': 'convert-plus', onclick: () => { n = Math.min(c.n, n + 1); upd(); g.sfx('tap'); } }, '+')),
    gain,
    L.energize ? h('label', { class: 'toggle' }, h('input', { type: 'checkbox', onchange: (e) => { energize = e.target.checked; upd(); } }), 'Energize (+3 value first)') : null,
    h('div', { class: 'actions' }, h('button', { class: 'act', 'data-testid': 'convert-go', onclick: async () => {
      const r = await g.act('act_convert', { reagent, n, energize }, { sound: 'coin' }); ov.close(); if (r) g.afterAction();
    } }, 'Convert')),
    L.convert1 ? h('button', { class: 'linkish', 'data-testid': 'convert-mixed', onclick: () => { ov.close(); convertMixed(g); } }, 'Sell a mix of reagents at 1 mana each') : null);
  ov.el.append(panel); upd();
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
  ov.el.append(h('div', { class: 'sheet-panel' }, h('div', { class: 'phase-title' }, 'Sell any mix at 1 mana each'), grid, h('div', { class: 'actions' }, go)));
}

// ------------------------------------------------------------------ pending steps: spell effects, New Research, dungeon
export async function effectChooser(g) {
  const pd = g.v.pending; const k = pd.spell; const info = g.cards[k] || {};
  const ov = openOverlay('gather', { testid: 'effect' });
  const [p, done] = wait();
  ov.el.append(h('div', { class: 'chooser-head' }, h('img', { src: art(k), alt: k, onclick: () => expandCard(g, k) }),
    h('div', {}, h('div', { class: 'phase-title' }, info.display), h('div', { class: 'ov-sub' }, info.effect))));
  const opts = pd.options;
  const grid = h('div', { class: 'opt-grid', 'data-testid': 'effect-options' });
  const pick = (choice) => () => { g.sfx('select'); done(choice); };
  const kind = pd.kind;
  if (['flame_bolt', 'disintegrate', 'earthquake', 'charm', 'creation'].includes(kind)) {
    const byP = {};
    for (const o of opts) (byP[o.player || 'Available'] ||= []).push(o);
    for (const [pl, os] of Object.entries(byP)) {
      grid.append(h('div', { class: 'group-label' }, pl));
      os.forEach((o, i) => grid.append(h('button', { class: 'opt-card', 'data-testid': `target-${pl}-${o.card}`, onclick: pick(o) }, h('img', { src: art(o.card), alt: o.card }), h('span', { class: 'oc-label' }, nice(o.kind)))));
    }
  } else if (kind === 'mana_drain') {
    grid.append(...opts.map((o) => h('button', { class: 'chip', 'data-testid': `target-${o.player}`, onclick: pick(o) }, avatar(o.player, 30), o.player)));
  } else if (kind === 'wand_tax') {
    grid.append(...opts.map((o) => h('button', { class: 'chip', 'data-testid': `school-${o.school}`, onclick: pick(o) }, h('img', { src: schoolIcon(o.school), alt: '' }), `${o.school} · +${o.gold} Gold`)));
  } else if (kind === 'time_shift') {
    grid.append(...opts.map((o) => h('button', { class: 'chip', 'data-testid': `deck-${o.deck}`, onclick: pick(o) }, `${nice(o.deck)} · remove ${o.n}`)));
  } else if (kind === 'scry') {
    grid.append(...opts.map((o) => h('button', { class: 'opt-card wide', 'data-testid': `scry-${o.card}`, onclick: pick(o) }, h('img', { src: art(o.card), alt: o.card }), h('span', { class: 'oc-text' }, g.cards[o.card]?.display || o.card))));
  } else if (kind === 'swapo') {
    const theirs = [...new Map(opts.map((o) => [`${o.player}|${o.card}`, o])).values()];
    grid.append(h('div', { class: 'group-label' }, 'Take one of theirs'));
    theirs.forEach((o) => grid.append(h('button', { class: 'opt-card', 'data-testid': `swapo-their-${o.card}`, onclick: () => {
      grid.innerHTML = ''; grid.append(h('div', { class: 'group-label' }, 'Give one of yours'));
      opts.filter((x) => x.player === o.player && x.card === o.card).forEach((x) => grid.append(h('button', { class: 'opt-card', 'data-testid': `swapo-mine-${x.mine}`, onclick: pick(x) }, h('img', { src: art(x.mine), alt: x.mine }))));
    } }, h('img', { src: art(o.card), alt: o.card }), h('span', { class: 'oc-label' }, o.player))));
  } else if (kind === 'transmute') {
    const tok = opts[0].tok; const sel = new Set();
    const go = h('button', { class: 'act', disabled: true, 'data-testid': 'transmute-go' }, 'Transmute');
    grid.append(...tok.map((r, i) => { const b = h('button', { class: 'tokbtn', 'data-testid': `transmute-${i}` }, h('img', { src: reagentIcon(r), alt: '' })); b.onclick = () => { if (sel.has(i)) { sel.delete(i); b.classList.remove('on'); } else { sel.add(i); b.classList.add('on'); } go.disabled = sel.size < 2 || sel.size % 2; go.textContent = `Transmute ${sel.size} → ${Math.floor(sel.size / 2)} Gold`; }; return b; }));
    grid.append(h('div', { class: 'actions' }, go));
    go.onclick = () => done({ reagents: [...sel].map((i) => tok[i]) });
  }
  ov.el.append(grid);
  const choice = await p;
  const r = await g.act('resolve_effect', { choice }, { sound: 'cast' });
  ov.close();
  return r;
}

export async function newResearchChooser(g) {
  const pd = g.v.pending;
  const ov = openOverlay('gather', { testid: 'new-research' });
  const [p, done] = wait();
  ov.el.append(h('div', { class: 'chooser-head' }, h('img', { src: art(pd.familiar), alt: '' }),
    h('div', {}, h('div', { class: 'phase-title' }, 'New Research'), h('div', { class: 'ov-sub' }, 'Take one of the four new spells'))));
  ov.el.append(h('div', { class: 'opt-grid' }, pd.four.map((k) => h('button', { class: 'opt-card wide', 'data-testid': `nr-${k}`, onclick: () => done(k) },
    h('img', { src: art(k), alt: k }), h('span', { class: 'oc-text' }, g.cards[k]?.display), h('span', { class: 'oc-label' }, g.cards[k]?.effect)))));
  const k = await p;
  const r = await g.act('choose_new_research', { spell: k }, { sound: 'select' });
  ov.close();
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
    ov.el.append(h('div', { class: 'ov-title' }, 'The Dungeon'),
      h('div', { class: 'hits', 'data-testid': 'dungeon-hits' }, 'Hits', ...pips, h('span', {}, `${pd.hits} / ${pd.limit}`)),
      deck, row);
    const acts = h('div', { class: 'actions' });
    if (pd.done) {
      ov.el.append(h('div', { class: `result ${pd.success ? 'good' : 'bad'}` }, pd.success ? 'The dungeon is exhausted' : 'Defeated! You keep nothing'));
      acts.append(h('button', { class: 'act', 'data-testid': 'dungeon-continue', onclick: () => done('stop') }, 'Continue'));
    } else if (pd.draws >= 1) {
      acts.append(h('button', { class: 'act', 'data-testid': 'dungeon-stop', onclick: () => done('stop') }, 'Stop & collect'));
    } else {
      acts.append(h('div', { class: 'ov-sub' }, 'Tap the deck to flip the first card'));
      acts.append(h('button', { class: 'act secondary', 'data-testid': 'dungeon-leave', onclick: () => done('leave') }, 'Leave'));
    }
    ov.el.append(acts);
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
        ov.el.append(h('div', { class: 'ov-title' }, 'The Dungeon'), h('div', { class: 'result good', 'data-testid': 'dungeon-result' }, `Collected ${gold} Gold${items.length ? ' + ' + items.join(', ') : ''}`), loot);
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
  ringEl.append(h('div', { class: 'arena-center' }, h('div', { class: 'card-frame', 'data-testid': 'arena-card' }, h('img', { src: art(card), alt: card, onclick: () => expandCard(g, card) })),
    h('div', { class: 'ov-sub', style: { margin: 0, fontSize: '13px' } }, g.cards[card]?.display), high));
  ring.forEach((n, i) => {
    const [x, y] = seatPos(i, ring.length);
    const b = h('div', { class: 'bid', 'data-testid': `bid-${n}` }, '–');
    const s = h('div', { class: 'seat', 'data-testid': `seat-${n}`, style: { left: `${x}%`, top: y < 50 ? `max(48px, ${y}%)` : `${y}%` } }, avatar(n, 44), h('div', { class: 'sname' }, n), b);
    seats[n] = s; bids[n] = b; ringEl.append(s);
  });
  const bar = h('div', { class: 'bidbar', 'data-testid': 'bidbar' });
  const msg = h('div', { class: 'winner-banner' });
  ov.el.append(h('div', { class: 'ov-title' }, 'Wizard Auction'), ringEl, msg, bar);

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
      bar.append(h('div', { class: 'ov-sub' }, `You have ${max} mana — you cannot beat ${min - 1}`), h('div', { class: 'bidbtns' }, h('button', { class: 'act secondary', 'data-testid': 'bid-pass', onclick: () => done({ pass: true }) }, 'Pass')));
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
      bar.append(out, mana, h('div', { class: 'ov-sub', style: { margin: 0 } }, `${val} is all your mana`), h('div', { class: 'bidbtns' }, passBtn, bidBtn));
      return p;
    }
    const sl = h('input', { type: 'range', class: 'slider', min, max, value: val, step: 1, 'data-testid': 'bid-slider' });
    const show = () => { sl.value = val; out.firstChild.textContent = String(val); };
    sl.oninput = () => { val = clamp(sl.value); show(); };
    const step = (d) => () => { val = clamp(val + d); show(); g.sfx('tap'); };
    bar.append(out, mana, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
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
  if (!el) { el = h('div', { class: 'banner', 'data-testid': 'ai-banner' }); layer.replaceChildren(el); }
  else { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
  el.dataset.move = `${i + 1}/${n}`;
  el.replaceChildren(avatar(e.who || '?'),
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
  ov.el.append(h('div', { class: 'ov-title' }, 'Game Over'), h('div', { class: 'winner', 'data-testid': 'winner' }, ranking(v).text), ...rankRows(v),
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
  ov.el.append(h('div', { class: 'sheet-panel' }, ...(scores.length ? scores : [h('div', { class: 'phase-title' }, 'Game')]),
    h('div', { class: 'actions' },
      h('button', { class: v.game_over ? 'act' : 'act secondary', 'data-testid': 'menu-new-game', onclick: () => { ov.close(); newGame(g); } }, v.game_over ? 'Play again (new game)' : 'New game'),
      v.game_over ? h('button', { class: 'act secondary', 'data-testid': 'menu-final-scores', onclick: () => { ov.close(); gameOver(g); } }, 'Final scores') : null,
      h('button', { class: 'act secondary', 'data-testid': 'menu-export', onclick: () => { ov.close(); g.exportSave(); } }, 'Export save file'),
      h('button', { class: 'act secondary', 'data-testid': 'menu-import', onclick: () => { ov.close(); g.importSave(); } }, 'Import save file'),
      h('button', { class: 'act danger', 'data-testid': 'menu-restart', onclick: () => { ov.close(); g.restart(); } }, 'Load the paused game g8')),
    h('div', { class: 'ov-sub' }, g.savedNote())));
}

// New game: Keith, Newt (AI) and LizWiz (AI), dealt by the engine's setup script; Keith picks 2 starting reagents.
export async function newGame(g) {
  const ov = openOverlay('gather newgame', { testid: 'new-game' });
  ov.el.append(closeBtn(() => ov.close(), 'new-game-cancel'), h('div', { class: 'ov-title' }, 'New game'), h('div', { class: 'ov-sub' }, 'Dealing…'));
  const pr = await g.call('new_game_preview', {});
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
  ov.el.append(closeBtn(() => ov.close(), 'new-game-cancel'), h('div', { class: 'ov-title' }, 'New game'),
    h('div', { class: 'ov-sub' }, `${players.join(', ')} · you start. This replaces the current game (export it first to keep it).`),
    h('div', { class: 'phase-title', style: { fontSize: '15px' } }, 'Your reagent cards'),
    h('div', { class: 'hand-preview', 'data-testid': 'new-game-hand' }, hand.map((k) => h('img', { src: art(k), alt: k, onclick: () => expandCard(g, k) }))),
    h('div', { class: 'phase-title', style: { fontSize: '15px' } }, 'Pick 2 different starting reagents'),
    h('div', { class: 'chips' }, chips), h('div', { class: 'actions' }, start));
  start.onclick = async () => {
    start.disabled = true;
    const r = await g.call('new_game_start', { picks });
    if (!r.ok) { g.toast(r.error); start.disabled = false; return; }
    closeAll();
    g.startedNewGame(r.view);
  };
}
