/** Pause dungeon door leaf animations at closed (start of swing) or mid (50% of active duration). */
export async function seekDungeonDoors(page, phase) {
  return page.evaluate((phaseIn) => {
    const doors = document.querySelector('[data-testid="dungeon-entry-doors"]');
    if (!doors) return { ok: false, reason: 'no-doors' };
    const leaves = [...doors.querySelectorAll('.dungeon-door-leaf')];
    const anims = leaves.flatMap((l) => l.getAnimations()).filter((a) => /dungeonDoor/i.test(a.animationName || ''));
    if (!anims.length) return { ok: false, reason: 'no-anims' };
    for (const a of anims) {
      a.pause();
      const delay = Number(a.effect?.delay) || 0;
      const dur = Number(a.effect?.duration) || 700;
      a.currentTime = phaseIn === 'closed' ? delay + 1 : delay + dur * 0.72;
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
    const within = (x, y) => dr && x >= dr.left && x <= dr.right && y >= dr.top && y <= dr.bottom;
    const cx = vw / 2;
    const cy = vh / 2;
    const at = (x, y) => document.elementsFromPoint(x, y).some((el) => el.closest?.('[data-testid="dungeon-entry-doors"], .dungeon-door-face, .dungeon-door-leaf'));
    const hitCenter = at(cx, cy) || within(cx, cy) || at((lf.left + lf.right) / 2, (lf.top + lf.bottom) / 2);
    const leave = document.querySelector('[data-testid="dungeon-leave"]');
    let hitLeave = false;
    if (leave) {
      const lb = leave.getBoundingClientRect();
      const lx = lb.left + lb.width / 2;
      const ly = lb.top + lb.height / 2;
      hitLeave = at(lx, ly) || within(lx, ly) || at((rf.left + rf.right) / 2, ly);
    }
    const seam = rf.left - lf.right;
    const wide = (unionR - unionL) / vw >= 0.95 && seam <= 6;
    return {
      ok: wide && hitCenter && hitLeave,
      widthFrac: (unionR - unionL) / vw,
      heightFrac: (unionB - unionT) / vh,
      coverage,
      hitCenter,
      hitLeave,
      seam,
    };
  });
}

export async function seekTreasureSparklePeak(page) {
  return page.evaluate(() => {
    const cell = document.querySelector('.dc.treasure-sparkle');
    if (!cell) return { ok: false, reason: 'no-cell' };
    const targets = [cell, ...cell.querySelectorAll('.treasure-spark')];
    let n = 0;
    for (const el of targets) {
      for (const a of el.getAnimations()) {
        a.pause();
        const dur = Number(a.effect?.duration) || 800;
        a.currentTime = dur * 0.42;
        n += 1;
      }
    }
    const spark = cell.querySelector('.treasure-spark.s1');
    const cs = spark ? getComputedStyle(spark) : null;
    const cellCs = getComputedStyle(cell);
    const rimOk = cellCs.boxShadow.includes('255') && cellCs.boxShadow.includes('235');
    const sparkOk = spark && Number(cs.opacity) >= 0.7;
    return { ok: n > 0 && rimOk && sparkOk, anims: n, rim: cellCs.boxShadow, opacity: cs?.opacity };
  });
}

export async function removeDungeonDoors(page) {
  return page.evaluate(() => {
    window.__dungeonDoorsHeld = false;
    document.querySelector('[data-testid="dungeon-entry-doors"]')?.remove();
  });
}