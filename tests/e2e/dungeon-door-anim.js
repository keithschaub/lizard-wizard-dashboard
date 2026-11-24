/** Pause dungeon door leaf animations at closed (start of swing) or mid (50% of active duration). */
export async function seekDungeonDoors(page, phase) {
  return page.evaluate((phaseIn) => {
    const cssMs = (raw, fallback) => {
      if (raw == null || raw === '') return fallback;
      const s = String(raw);
      const n = parseFloat(s);
      if (Number.isNaN(n)) return fallback;
      if (s.includes('ms')) return n;
      return n * 1000;
    };
    const doors = document.querySelector('[data-testid="dungeon-entry-doors"]');
    if (!doors) return { ok: false, reason: 'no-doors' };
    const leaves = [...doors.querySelectorAll('.dungeon-door-leaf')];
    const anims = leaves.flatMap((l) => l.getAnimations()).filter((a) => /dungeonDoor/i.test(a.animationName || ''));
    if (!anims.length) return { ok: false, reason: 'no-anims' };
    const ref = getComputedStyle(leaves[0]);
    const durMs = cssMs(ref.animationDuration, 750);
    const delayMs = cssMs(ref.animationDelay, 350);
    for (const a of anims) {
      a.pause();
      a.currentTime = phaseIn === 'closed' ? delayMs + 1 : delayMs + durMs * 0.5;
    }
    doors.dataset.doorPhase = phaseIn === 'closed' ? 'closed' : 'opening';
    doors.classList.toggle('opening', phaseIn !== 'closed');
    window.__dungeonDoorsHeld = true;
    return { ok: true, phase: phaseIn, anims: anims.length };
  }, phase);
}

export async function metricsAtClosedDoors(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const lf = document.querySelector('.dungeon-door-left .dungeon-door-face')?.getBoundingClientRect();
    const rf = document.querySelector('.dungeon-door-right .dungeon-door-face')?.getBoundingClientRect();
    if (!lf || !rf) return { ok: false, reason: 'no-faces' };
    const doors = document.querySelector('[data-testid="dungeon-entry-doors"]');
    const dr = doors?.getBoundingClientRect();
    const unionL = Math.min(lf.left, rf.left);
    const unionR = Math.max(lf.right, rf.right);
    const unionT = Math.min(lf.top, rf.top);
    const unionB = Math.max(lf.bottom, rf.bottom);
    const coverage = ((unionR - unionL) / vw) * ((unionB - unionT) / vh);
    const doorTop = (x, y) => {
      const top = document.elementFromPoint(x, y);
      return !!top?.closest?.('[data-testid="dungeon-entry-doors"], .dungeon-door-face, .dungeon-door-leaf, .dungeon-door-band');
    };
    const cx = vw / 2;
    const cy = vh / 2;
    const hitCenter = doorTop(cx, cy);
    const leave = document.querySelector('[data-testid="dungeon-leave"]');
    let hitLeave = false;
    if (leave) {
      const lb = leave.getBoundingClientRect();
      hitLeave = doorTop(lb.left + lb.width / 2, lb.top + lb.height / 2);
    }
    const eye = document.querySelector('[data-testid="eye-toggle"]') || document.querySelector('.peek-btn');
    let hitEye = true;
    if (eye) {
      const eb = eye.getBoundingClientRect();
      hitEye = doorTop(eb.left + eb.width / 2, eb.top + eb.height / 2);
    }
    const seam = rf.left - lf.right;
    const wide = (unionR - unionL) / vw >= 0.95 && seam <= 6;
    return {
      ok: wide && hitCenter && hitLeave && hitEye,
      widthFrac: (unionR - unionL) / vw,
      heightFrac: (unionB - unionT) / vh,
      coverage,
      hitCenter,
      hitLeave,
      hitEye,
      seam,
    };
  });
}

/** At 50% swing, deck center and viewport center at band height must not be covered by doors. */
export async function metricsMidDoorClearance(page) {
  return page.evaluate(() => {
    const deck = document.querySelector('[data-testid="dungeon-deck"]');
    if (!deck) return { ok: false, reason: 'no-deck' };
    const db = deck.getBoundingClientRect();
    const dcx = db.left + db.width / 2;
    const dcy = db.top + db.height / 2;
    const band = document.querySelector('.dungeon-door-band-top');
    const br = band?.getBoundingClientRect();
    const bandY = br ? br.top + br.height / 2 : window.innerHeight * 0.28;
    const cx = window.innerWidth / 2;
    const deckAt = (x, y) => !!document.elementFromPoint(x, y)?.closest?.('[data-testid="dungeon-deck"]');
    const doorAt = (x, y) => !!document.elementFromPoint(x, y)?.closest?.(
      '[data-testid="dungeon-entry-doors"], .dungeon-door-leaf, .dungeon-door-face, .dungeon-door-band');
    const hitDeckCenter = deckAt(dcx, dcy);
    const hitBandRow = deckAt(cx, bandY);
    const blockedCenter = doorAt(dcx, dcy);
    const blockedBandRow = doorAt(cx, bandY);
    return {
      ok: hitDeckCenter && hitBandRow && !blockedCenter && !blockedBandRow,
      hitDeckCenter,
      hitBandRow,
      blockedCenter,
      blockedBandRow,
      bandY,
    };
  });
}

export async function seekTreasureSparklePeak(page) {
  return page.evaluate(() => {
    const cell = document.querySelector('.dc.treasure-sparkle');
    if (!cell) return { ok: false, reason: 'no-cell' };
    let n = 0;
    const cssMs = (raw, fallback) => {
      const s = String(raw ?? '');
      const n = parseFloat(s);
      if (Number.isNaN(n)) return fallback;
      if (s.includes('ms')) return n;
      return n * 1000;
    };
    const pauseAll = (el) => {
      const ref = getComputedStyle(el);
      const durMs = cssMs(ref.animationDuration, 800);
      const delayMs = cssMs(ref.animationDelay, 0);
      for (const a of el.getAnimations()) {
        a.pause();
        a.currentTime = delayMs + durMs * 0.45;
        n += 1;
      }
    };
    pauseAll(cell);
    cell.querySelectorAll('.treasure-spark').forEach(pauseAll);
    const spark = cell.querySelector('.treasure-spark.s1');
    const cs = spark ? getComputedStyle(spark) : null;
    const cellCs = getComputedStyle(cell);
    const rimRgb = cellCs.borderColor;
    const rimOk = /245|197|66/.test(rimRgb) && parseFloat(cellCs.borderTopWidth) >= 2.5;
    const glowOk = /245|197|66/.test(cellCs.boxShadow) && cellCs.boxShadow !== 'none';
    const sparkOk = spark && Number(cs.opacity) >= 0.85 && spark.getBoundingClientRect().width >= 14;
    return { ok: n > 0 && rimOk && glowOk && sparkOk, anims: n, rim: rimRgb, shadow: cellCs.boxShadow, opacity: cs?.opacity };
  });
}

export async function removeDungeonDoors(page) {
  return page.evaluate(() => {
    window.__dungeonDoorsHeld = false;
    document.querySelector('[data-testid="dungeon-entry-doors"]')?.remove();
  });
}