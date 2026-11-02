// Animation library: easings, intro/outro presets, mid-section (hold) effects.
// A preset describes the "hidden" state of a unit (letter, word, line or whole layer).
// Intro animates hidden -> rest, outro animates rest -> hidden.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

const c1 = 1.70158, c3 = c1 + 1;
function bounceOut(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}
export const EASES = {
  linear: x => x,
  inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
  inQuad: x => x * x,
  outQuad: x => 1 - (1 - x) * (1 - x),
  inCubic: x => x * x * x,
  outCubic: x => 1 - Math.pow(1 - x, 3),
  inOutCubic: x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  outQuart: x => 1 - Math.pow(1 - x, 4),
  inQuart: x => x * x * x * x,
  outExpo: x => x === 1 ? 1 : 1 - Math.pow(2, -10 * x),
  inExpo: x => x === 0 ? 0 : Math.pow(2, 10 * x - 10),
  inOutExpo: x => x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  outBack: x => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2),
  inBack: x => c3 * x * x * x - c1 * x * x,
  outElastic: x => x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
  outBounce: bounceOut,
  step: x => x <= 0 ? 0 : 1,
};
export const EASE_NAMES = {
  outCubic: 'Smooth stop', outQuart: 'Silky stop', outExpo: 'Quick then gentle', inOutSine: 'Gentle both ends',
  inOutCubic: 'Smooth both ends', inOutExpo: 'Dramatic both ends', outBack: 'Slight overshoot', outElastic: 'Springy',
  outBounce: 'Bounce', linear: 'Even', inCubic: 'Smooth start', inQuart: 'Silky start', inExpo: 'Slow then fast',
  inBack: 'Wind up', inQuad: 'Accelerate', outQuad: 'Decelerate', step: 'Instant',
};
const OUT_EASE = { outCubic: 'inCubic', outQuart: 'inQuart', outExpo: 'inExpo', outBack: 'inBack', outElastic: 'inBack', outBounce: 'inQuad', outQuad: 'inQuad' };

// Rest state
export const REST = { o: 1, x: 0, y: 0, s: 1, sx: 1, sy: 1, r: 0, b: 0, sk: 0, wipe: 1, radial: 1, spread: 0 };

// Seeded random per unit
export function rand(seed) {
  let t = (seed * 2654435761) >>> 0;
  t += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rnd = (seed, k) => rand(seed * 31 + k * 7919 + 17);
const sym = (seed, k) => rnd(seed, k) * 2 - 1;

// ---------- Presets ----------
// group: for the picker. by/ease/duration/stagger are sensible defaults applied when chosen.
export const PRESETS = [
  { id: 'none', name: 'None', outName: 'None (stays)', group: 'Simple' },
  { id: 'fade', name: 'Fade in', outName: 'Fade out', group: 'Simple', from: { o: 0 }, ease: 'inOutSine', by: 'all', duration: 0.9, stagger: 0 },
  { id: 'rise', name: 'Rise', outName: 'Lift away', group: 'Simple', from: { o: 0, y: 36 }, ease: 'outCubic', by: 'word', duration: 0.8, stagger: 0.08 },
  { id: 'fall', name: 'Fall in', outName: 'Sink away', group: 'Simple', from: { o: 0, y: -36 }, ease: 'outCubic', by: 'word', duration: 0.8, stagger: 0.08 },
  { id: 'fromLeft', name: 'Slide from left', outName: 'Slide off right', group: 'Simple', from: { o: 0, x: -90 }, ease: 'outQuart', by: 'line', duration: 0.9, stagger: 0.12 },
  { id: 'fromRight', name: 'Slide from right', outName: 'Slide off left', group: 'Simple', from: { o: 0, x: 90 }, ease: 'outQuart', by: 'line', duration: 0.9, stagger: 0.12 },
  { id: 'focus', name: 'Soft focus', outName: 'Soft blur away', group: 'Simple', from: { o: 0, b: 22, s: 1.05 }, ease: 'outCubic', by: 'word', duration: 1.1, stagger: 0.1 },
  { id: 'grow', name: 'Grow', outName: 'Shrink', group: 'Simple', from: { o: 0, s: 0.6 }, ease: 'outCubic', by: 'all', duration: 0.9, stagger: 0 },
  { id: 'settle', name: 'Settle', outName: 'Expand away', group: 'Simple', from: { o: 0, s: 1.3, b: 6 }, ease: 'outQuart', by: 'all', duration: 1.1, stagger: 0 },
  { id: 'wipe', name: 'Wipe (left to right)', outName: 'Wipe away (left to right)', group: 'Reveal', from: { wipe: 0 }, wipeDir: 'right', ease: 'inOutCubic', by: 'line', duration: 1.0, stagger: 0.2 },
  { id: 'wipeUp', name: 'Reveal upward', outName: 'Hide downward', group: 'Reveal', from: { wipe: 0, y: 14 }, wipeDir: 'up', ease: 'outCubic', by: 'line', duration: 0.9, stagger: 0.18 },
  { id: 'radial', name: 'Radial reveal', outName: 'Radial close', group: 'Reveal', from: { radial: 0 }, ease: 'inOutCubic', by: 'all', duration: 1.2, stagger: 0 },
  { id: 'gather', name: 'Letters gather', outName: 'Letters spread', group: 'Reveal', from: { o: 0, spread: 0.5, b: 8 }, ease: 'outCubic', by: 'letter', duration: 1.2, stagger: 0 },
  { id: 'typewriter', name: 'Typewriter', outName: 'Backspace', group: 'Reveal', from: { o: 0 }, ease: 'step', by: 'letter', duration: 0.05, stagger: 0.06 },
  { id: 'pop', name: 'Pop', outName: 'Pop away', group: 'Lively', from: { o: 0, s: 0.3 }, ease: 'outBack', by: 'word', duration: 0.55, stagger: 0.08 },
  { id: 'bounce', name: 'Drop & bounce', outName: 'Drop away', group: 'Lively', from: { o: 0, y: -140 }, ease: 'outBounce', by: 'letter', duration: 0.9, stagger: 0.04 },
  { id: 'flip', name: 'Flip up', outName: 'Flip down', group: 'Lively', from: { o: 0, sy: 0, y: 18 }, ease: 'outCubic', by: 'letter', duration: 0.6, stagger: 0.035 },
  { id: 'cascade', name: 'Letter cascade', outName: 'Letter tumble', group: 'Lively', from: { o: 0, y: -34, r: -10 }, ease: 'outCubic', by: 'letter', duration: 0.7, stagger: 0.035 },
  { id: 'wave', name: 'Wave in', outName: 'Wave out', group: 'Lively', from: { o: 0, y: 34, s: 0.7 }, ease: 'outBack', by: 'letter', duration: 0.6, stagger: 0.03 },
  { id: 'spin', name: 'Spin in', outName: 'Spin out', group: 'Lively', from: { o: 0, r: -120, s: 0.5 }, ease: 'outCubic', by: 'all', duration: 1.0, stagger: 0 },
  { id: 'sweep', name: 'Sweep', outName: 'Sweep off', group: 'Lively', from: { o: 0, x: -70, sk: -22 }, ease: 'outQuart', by: 'word', duration: 0.8, stagger: 0.07 },
  { id: 'scatter', name: 'Gather from scatter', outName: 'Scatter', group: 'Magic', kind: 'random', rnd: { x: 420, y: 420, r: 160, b: 10, s: 0.4 }, ease: 'outCubic', by: 'letter', duration: 1.4, stagger: 0.01 },
  { id: 'smoke', name: 'Out of smoke', outName: 'Into smoke', group: 'Magic', kind: 'random', rnd: { x: 50, y: -60, r: 18, b: 26, s: -0.25, up: 1 }, ease: 'outCubic', by: 'letter', duration: 1.4, stagger: 0.04 },
  { id: 'wind', name: 'Blown in', outName: 'Blown away', group: 'Magic', kind: 'random', rnd: { x: 520, y: -180, r: 140, b: 6, s: 0, wind: 1 }, ease: 'outCubic', by: 'letter', duration: 1.3, stagger: 0.035 },
  { id: 'particles', name: 'Assemble from particles', outName: 'Dissolve into particles', group: 'Magic', kind: 'particles', ease: 'inOutCubic', by: 'all', duration: 1.8, stagger: 0 },
  { id: 'birds', name: 'Birds gather into text', outName: 'Turn into birds & fly away', group: 'Magic', kind: 'birds', ease: 'linear', by: 'all', duration: 3.0, stagger: 0 },
  { id: 'custom', name: 'Custom', outName: 'Custom', group: 'Custom', from: { o: 0 }, ease: 'outCubic' },
];
export const PRESET = Object.fromEntries(PRESETS.map(p => [p.id, p]));

export const MIDS = [
  { id: 'none', name: 'Still (cleanest for trimming)' },
  { id: 'pulse', name: 'Pulse', period: 2.4, amount: 1, color: '#FFE7A8' },
  { id: 'breathe', name: 'Breathe', period: 4, amount: 1 },
  { id: 'float', name: 'Float', period: 4, amount: 1 },
  { id: 'sway', name: 'Sway', period: 5, amount: 1 },
  { id: 'wave', name: 'Letter wave', period: 2.5, amount: 1 },
  { id: 'glow', name: 'Glow', period: 3, amount: 1, color: '#FFE7A8' },
  { id: 'shimmer', name: 'Shimmer sweep', period: 3, amount: 1, color: '#FFF6DC' },
  { id: 'flicker', name: 'Candle flicker', period: 1, amount: 1 },
  { id: 'shake', name: 'Shake', period: 0.5, amount: 1 },
  { id: 'rotate', name: 'Slow turn', period: 30, amount: 1 },
];
export const MID = Object.fromEntries(MIDS.map(m => [m.id, m]));

function fromState(spec, preset, phase, seed, layerSeed) {
  if (preset.id === 'custom') return { ...REST, ...(phase === 'in' ? spec.from || {} : spec.to || spec.from || {}) };
  if (preset.kind === 'random') {
    const k = preset.rnd, sd = seed + layerSeed * 1000;
    const st = { ...REST, o: 0 };
    if (k.wind) {
      st.x = (phase === 'in' ? -1 : 1) * (k.x * (0.5 + rnd(sd, 1)));
      st.y = k.y * (0.3 + rnd(sd, 2)) + sym(sd, 6) * 60;
    } else {
      st.x = sym(sd, 1) * k.x;
      st.y = k.up ? k.y * (0.5 + rnd(sd, 2)) : sym(sd, 2) * k.y;
    }
    st.r = sym(sd, 3) * k.r;
    st.b = k.b * (0.5 + rnd(sd, 4) * 0.5);
    st.s = 1 + (k.s >= 0 ? sym(sd, 5) * k.s : k.s * rnd(sd, 5) * -1 + 0.15);
    return st;
  }
  const f = { ...REST, ...(preset.from || {}) };
  if (phase === 'out') {
    if (preset.to) return { ...REST, ...preset.to };
    // continue the motion: mirror directional values
    f.x = -f.x; f.y = -f.y; f.r = -f.r; f.sk = -f.sk;
  }
  return f;
}

export function easeFor(spec, preset, phase) {
  let e = spec.ease || preset.ease || 'outCubic';
  if (phase === 'out' && !spec.ease) e = OUT_EASE[e] || e;
  return EASES[e] || EASES.outCubic;
}

// order index for a unit given stagger direction
export function orderIndex(i, n, dir, seed) {
  if (n <= 1) return 0;
  switch (dir) {
    case 'reverse': return n - 1 - i;
    case 'center': return Math.abs(i - (n - 1) / 2);
    case 'edges': return (n - 1) / 2 - Math.abs(i - (n - 1) / 2);
    case 'random': return rand(i * 97 + seed) * (n - 1);
    default: return i;
  }
}

// Mix two states
function mix(a, b, t) {
  const o = {};
  for (const k in REST) o[k] = lerp(a[k], b[k], t);
  return o;
}

// Compute unit state for a given phase spec.
// p: raw 0..1 progress (0 = start of animation)
export function phaseState(spec, phase, p, unitSeed, layerSeed) {
  const preset = PRESET[spec.preset] || PRESET.none;
  if (preset.id === 'none') return { ...REST };
  const hidden = fromState(spec, preset, phase, unitSeed, layerSeed);
  const e = easeFor(spec, preset, phase)(clamp(p));
  if (phase === 'in') return mix(hidden, REST, e);
  return mix(REST, hidden, e);
}

// Mid (hold) effect, returns additive/multiplicative offsets for the layer or unit
export function midState(mid, tau, unitIdx = 0, unitCount = 1) {
  const m = MID[mid?.preset] || MID.none;
  const out = { y: 0, x: 0, s: 1, r: 0, o: 1, glow: 0, shimmer: -1 };
  if (m.id === 'none') return out;
  const amt = mid.amount ?? 1, P = Math.max(0.2, mid.period || m.period);
  const ph = (tau / P) * Math.PI * 2;
  switch (m.id) {
    case 'pulse': { const w = (1 - Math.cos(ph)) / 2; out.s = 1 + 0.06 * amt * w; out.glow = w * amt; break; }
    case 'breathe': out.s = 1 + 0.025 * amt * Math.sin(ph); break;
    case 'float': out.y = -10 * amt * Math.sin(ph); break;
    case 'sway': out.r = 1.6 * amt * Math.sin(ph); break;
    case 'wave': out.y = -8 * amt * Math.sin(ph - unitIdx * 0.45); break;
    case 'glow': out.glow = (0.55 + 0.45 * (1 - Math.cos(ph)) / 2) * amt; break;
    case 'shimmer': out.shimmer = ((tau % P) / P); break;
    case 'flicker': out.o = 1 - 0.08 * amt * (0.5 + 0.5 * Math.sin(ph * 3.1) * Math.sin(ph * 1.7 + 1)); break;
    case 'rotate': out.r = (tau / P) * 360 * (amt >= 0 ? 1 : -1); break;
    case 'shake': { const k = tau * (12 / P); out.x = 7 * amt * (Math.sin(k * 5.1) * 0.6 + Math.sin(k * 8.7 + 1.3) * 0.4); out.y = 5 * amt * (Math.sin(k * 6.3 + 2.1) * 0.6 + Math.sin(k * 9.9) * 0.4); out.r = 0.9 * amt * Math.sin(k * 7.4 + 0.7); break; }
  }
  return out;
}
