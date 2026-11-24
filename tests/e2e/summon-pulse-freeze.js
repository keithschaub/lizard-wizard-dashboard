/** Deterministic summon pulse / score blink freeze for screenshots and assertions. */

export async function freezeSummonPulsePeakWhenReady(page, index, { schoolSlug = null, timeoutMs = 10000, atMs = null } = {}) {
  const idx = String(index);
  return page.evaluate(async ({ i, slug, timeout, peakAtMs }) => {
    const cssMs = (raw, fallback) => {
      if (raw == null || raw === '') return fallback;
      const s = String(raw);
      const n = parseFloat(s);
      if (Number.isNaN(n)) return fallback;
      if (s.includes('ms')) return n;
      return n * 1000;
    };
    const deadline = performance.now() + timeout;
    const frameSel = slug
      ? (f) => f.classList.contains('summon-pulse') && f.classList.contains(`summon-pulse-${slug}`) && f.dataset.index === i
      : (f) => f.classList.contains('summon-pulse') && f.dataset.index === i;

    while (performance.now() < deadline) {
      const frames = [...document.querySelectorAll('.big-frame.summon-pulse')];
      const frame = frames.find(frameSel);
      const img = frame?.querySelector('img.big');
      if (!frame || !img) {
        await new Promise((r) => setTimeout(r, 12));
        continue;
      }
      const anims = img.getAnimations().filter((a) => {
        const n = a.animationName || '';
        return /summon-pulse-img/i.test(n) || (n !== 'none' && frame.classList.contains('summon-pulse'));
      });
      const frameCs = getComputedStyle(frame);
      const pulseColor = frameCs.getPropertyValue('--summon-pulse-color').trim();
      const pulseEdge = frameCs.getPropertyValue('--summon-pulse-edge').trim();
      const durMs = cssMs(getComputedStyle(img).animationDuration, 600);
      const delayMs = cssMs(getComputedStyle(img).animationDelay, 0);
      let peakMs = peakAtMs != null ? delayMs + peakAtMs : delayMs + durMs * 0.5;
      if (anims.length) {
        for (const a of anims) {
          a.pause();
          a.currentTime = peakMs;
        }
      }
      void img.offsetWidth;
      let imgCs = getComputedStyle(img);
      let boxShadow = imgCs.boxShadow;
      if (boxShadow === 'none' && (pulseColor || pulseEdge)) {
        if (pulseEdge) {
          img.style.boxShadow = `0 0 0 6px ${pulseEdge}, 0 0 32px 18px ${pulseColor || 'rgba(8, 8, 10, 0.95)'}`;
        } else if (pulseColor && pulseColor !== 'none') {
          img.style.boxShadow = `0 0 0 6px ${pulseColor}, 0 0 22px 8px ${pulseColor}`;
        }
        imgCs = getComputedStyle(img);
        boxShadow = imgCs.boxShadow;
      }
      if (boxShadow === 'none') {
        await new Promise((r) => setTimeout(r, 12));
        continue;
      }
      const rect = img.getBoundingClientRect();
      return {
        ok: boxShadow !== 'none',
        anims: anims.length,
        peakMs,
        pulseVar: frameCs.getPropertyValue('--summon-pulse-color').trim(),
        pulseEdge: frameCs.getPropertyValue('--summon-pulse-edge').trim(),
        boxShadow,
        slug: frame.className,
        index: frame.dataset.index,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }
    return { ok: false, reason: 'timeout' };
  }, { i: idx, slug: schoolSlug, timeout: timeoutMs, peakAtMs: atMs });
}

export async function waitForSummonPulseOnIndex(page, index, opts = {}) {
  const peak = await freezeSummonPulsePeakWhenReady(page, index, opts);
  if (!peak.ok) throw new Error(`waitForSummonPulseOnIndex: ${JSON.stringify(peak)}`);
  return peak;
}

/** @deprecated use freezeSummonPulsePeakWhenReady */
export async function freezeSummonPulsePeak(page, index) {
  return freezeSummonPulsePeakWhenReady(page, index);
}

export async function freezeScoreBlinkPeakWhenReady(page, cardSelector, { timeoutMs = 5000 } = {}) {
  return page.evaluate(async ({ sel, timeout }) => {
    const cssMs = (raw, fallback) => {
      const s = String(raw ?? '');
      const n = parseFloat(s);
      if (Number.isNaN(n)) return fallback;
      if (s.includes('ms')) return n;
      return n * 1000;
    };
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      const el = document.querySelector(sel);
      if (!el) {
        await new Promise((r) => setTimeout(r, 12));
        continue;
      }
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const anims = el.getAnimations().filter((a) => /score-school-blink/i.test(a.animationName || ''));
      if (!anims.length) {
        await new Promise((r) => setTimeout(r, 12));
        continue;
      }
      const durMs = cssMs(getComputedStyle(el).animationDuration, 400);
      const peakMs = durMs * 0.5;
      for (const a of anims) {
        a.pause();
        a.currentTime = peakMs;
      }
      void el.offsetWidth;
      const cs = getComputedStyle(el);
      const boxShadow = cs.boxShadow;
      const rect = el.getBoundingClientRect();
      return {
        ok: boxShadow !== 'none',
        peakMs,
        blinkVar: cs.getPropertyValue('--score-blink-color').trim(),
        boxShadow,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }
    return { ok: false, reason: 'timeout' };
  }, { sel: cardSelector, timeout: timeoutMs });
}

export async function freezeScoreBlinkPeak(page, cardSelector) {
  return freezeScoreBlinkPeakWhenReady(page, cardSelector);
}

export async function screenshotZoomFromRect(page, rect, outPath, { pad = 56 } = {}) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const spanW = (rect.width + pad * 2) / 2;
  const spanH = (rect.height + pad * 2) / 2;
  const vp = page.viewportSize();
  await page.screenshot({
    path: outPath,
    scale: 'device',
    clip: {
      x: Math.max(0, cx - spanW / 2),
      y: Math.max(0, cy - spanH / 2),
      width: Math.min(spanW, vp?.width ?? spanW),
      height: Math.min(spanH, vp?.height ?? spanH),
    },
  });
}