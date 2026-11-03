// Synthesised sound effects (WebAudio, no audio files) + phone haptics (navigator.vibrate), one mute toggle for both.
const KEY = 'lw.muted';
let ctx = null;
let muted = localStorage.getItem(KEY) === '1';

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, dur, { type = 'sine', gain = 0.12, at = 0, slide = null, attack = 0.005 } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(); const g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { gain = 0.1, at = 0, from = 4000, to = 600, q = 1.2 } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t); src.stop(t + dur + 0.02);
}

const SFX = {
  tap: () => tone(660, 0.06, { type: 'triangle', gain: 0.06, slide: 520 }),
  select: () => tone(880, 0.09, { type: 'sine', gain: 0.08, slide: 1320 }),
  unselect: () => tone(700, 0.08, { type: 'sine', gain: 0.06, slide: 420 }),
  gather: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.07, at: i * 0.06 })),
  coin: () => { tone(1568, 0.12, { type: 'square', gain: 0.03 }); tone(2093, 0.25, { type: 'square', gain: 0.03, at: 0.07 }); },
  flip: () => noise(0.18, { gain: 0.16, from: 3000, to: 900 }),
  cast: () => { noise(0.6, { gain: 0.08, from: 300, to: 5000, q: 0.8 }); [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.4, { gain: 0.04, at: 0.15 + i * 0.05 })); },
  bid: () => tone(330, 0.09, { type: 'square', gain: 0.04, slide: 300 }),
  pass: () => tone(240, 0.14, { type: 'sine', gain: 0.06, slide: 180 }),
  hit: () => { tone(110, 0.3, { type: 'sawtooth', gain: 0.09, slide: 55 }); noise(0.2, { gain: 0.1, from: 800, to: 200 }); },
  build: () => { tone(196, 0.18, { type: 'triangle', gain: 0.1 }); tone(294, 0.25, { type: 'triangle', gain: 0.08, at: 0.12 }); },
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.35, { type: 'triangle', gain: 0.07, at: i * 0.09 })),
  error: () => tone(150, 0.2, { type: 'sawtooth', gain: 0.05, slide: 120 }),
  turn: () => { tone(587, 0.16, { gain: 0.06 }); tone(880, 0.3, { gain: 0.06, at: 0.1 }); },
};
const BUZZ = { tap: 8, select: 12, gather: [18, 40, 18], coin: 15, cast: [30, 50, 30], hit: [60, 40, 60], win: [40, 60, 40, 60, 80], error: [70], build: 25, turn: 20, bid: 10, flip: 10 };

export function play(name) {
  if (muted) return;
  try { SFX[name]?.(); } catch { /* audio unavailable */ }
  const v = BUZZ[name];
  if (v && navigator.vibrate) { try { navigator.vibrate(v); } catch { /* not allowed */ } }
}
export function isMuted() { return muted; }
export function setMuted(m) { muted = m; localStorage.setItem(KEY, m ? '1' : '0'); }
export function unlock() { if (!muted) ac(); }
