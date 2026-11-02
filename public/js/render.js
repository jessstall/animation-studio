// Rendering engine: lays out rich text, evaluates animations per unit and draws a frame.
import { clamp, lerp, rand, EASES, PRESET, REST, phaseState, midState, orderIndex, easeFor } from './anims.js';

let fontVersion = 0;
const layoutCache = new Map();
const unitCache = new Map();
const imgCache = new Map();
const tintCache = new Map();
const restCache = new Map();
let onAsset = () => {};
export function setAssetListener(fn) { onAsset = fn; }
export function bumpFonts() { fontVersion++; layoutCache.clear(); unitCache.clear(); restCache.clear(); }

const mctx = document.createElement('canvas').getContext('2d');
export const fontStr = r => `${r.italic ? 'italic ' : ''}${r.weight || 400} ${r.size}px "${r.font}", "Cormorant Garamond", serif`;

// ---------- images ----------
export function getImage(src) {
  if (!src) return null;
  let e = imgCache.get(src);
  if (!e) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    e = { img, ok: false };
    img.onload = () => { e.ok = true; tintCache.clear(); restCache.clear(); onAsset(); };
    img.src = src;
    imgCache.set(src, e);
  }
  return e.ok ? e.img : null;
}
export function imagesReady(project) {
  return Promise.all(project.layers.filter(l => l.type === 'image').map(l => new Promise(res => {
    getImage(l.src); const e = imgCache.get(l.src);
    if (e.ok) return res();
    e.img.addEventListener('load', res, { once: true }); e.img.addEventListener('error', res, { once: true });
  })));
}
function tinted(img, color) {
  if (!color) return img;
  const key = img.src.slice(0, 200) + img.src.length + color;
  let c = tintCache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    tintCache.set(key, c);
  }
  return c;
}

// ---------- text layout ----------
export function layoutText(layer) {
  const key = JSON.stringify([layer.lines, layer.align, layer.lineHeight, layer.tracking, fontVersion]);
  const hit = layoutCache.get(layer.id);
  if (hit && hit.key === key) return hit.layout;
  const lines = [];
  for (let li = 0; li < layer.lines.length; li++) {
    const L = layer.lines[li];
    const chars = [];
    let x = 0, asc = 0, desc = 0, maxSize = 0, lastTr = 0;
    L.runs.forEach((run, ri) => {
      mctx.font = fontStr(run);
      const tr = (layer.tracking || 0) / 1000 * run.size;
      const mm = mctx.measureText('HgÉ');
      asc = Math.max(asc, mm.fontBoundingBoxAscent ?? run.size * 0.8);
      desc = Math.max(desc, mm.fontBoundingBoxDescent ?? run.size * 0.25);
      maxSize = Math.max(maxSize, run.size);
      const gs = Array.from(run.text);
      let prefix = '';
      gs.forEach((g, gi) => {
        const px = mctx.measureText(prefix).width + gi * tr;
        chars.push({ ch: g, run, ri, x: x + px, space: /\s/.test(g) });
        prefix += g;
      });
      const w = mctx.measureText(run.text).width + gs.length * tr;
      x += w; lastTr = gs.length ? tr : lastTr;
    });
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (i + 1 < chars.length) c.w = chars[i + 1].x - c.x;
      else { mctx.font = fontStr(c.run); c.w = mctx.measureText(c.ch).width; }
    }
    if (!maxSize) { const r = L.runs[0] || { size: 96 }; maxSize = r.size; asc = r.size * 0.8; desc = r.size * 0.25; }
    lines.push({ chars, w: Math.max(0, x - lastTr), asc, desc, maxSize, gap: L.gap || 0, dx: L.dx || 0, box: maxSize * (layer.lineHeight || 1.15) });
  }
  const width = Math.max(1, ...lines.map(l => l.w));
  let height = 0;
  lines.forEach((l, i) => { height += l.box + (i > 0 ? l.gap : 0); });
  let y = -height / 2;
  lines.forEach((l, i) => {
    if (i > 0) y += l.gap;
    l.baseline = y + (l.box - (l.asc + l.desc)) / 2 + l.asc;
    l.top = y; y += l.box;
    l.x0 = layer.align === 'left' ? -width / 2 + l.dx : layer.align === 'right' ? width / 2 - l.w + l.dx : -l.w / 2 + l.dx;
    for (const c of l.chars) { c.ax = l.x0 + c.x; c.by = l.baseline; c.li = i; }
  });
  const layout = { lines, width, height };
  layoutCache.set(layer.id, { key, layout });
  return layout;
}

function bboxOf(chars, layout) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of chars) {
    const l = layout.lines[c.li];
    x0 = Math.min(x0, c.ax); x1 = Math.max(x1, c.ax + c.w);
    y0 = Math.min(y0, c.by - l.asc); y1 = Math.max(y1, c.by + l.desc);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function getUnits(layer, by) {
  if (layer.type === 'image') {
    const h = layer.width * (layer.natH || 1) / (layer.natW || 1);
    return [{ chars: [], line: 0, bbox: { x: -layer.width / 2, y: -h / 2, w: layer.width, h, cx: 0, cy: 0 } }];
  }
  if (layer.type === 'light') {
    const r = Math.max(layer.lights.orb.on ? layer.lights.orb.size : 0, layer.lights.rays.on ? layer.lights.rays.length : 0, 100);
    return [{ chars: [], line: 0, bbox: { x: -r, y: -r, w: 2 * r, h: 2 * r, cx: 0, cy: 0 } }];
  }
  const layout = layoutText(layer);
  const key = layer.id + '|' + by + '|' + JSON.stringify([layer.lines, layer.align, layer.lineHeight, layer.tracking, fontVersion]);
  const hit = unitCache.get(layer.id + by);
  if (hit && hit.key === key) return hit.units;
  const groups = [];
  if (by === 'all') groups.push(layout.lines.flatMap(l => l.chars.filter(c => !c.space)));
  else for (const l of layout.lines) {
    const vis = l.chars;
    if (by === 'line') groups.push(vis.filter(c => !c.space));
    else if (by === 'letter') vis.forEach(c => { if (!c.space) groups.push([c]); });
    else { // word
      let cur = [];
      vis.forEach(c => { if (c.space) { if (cur.length) groups.push(cur); cur = []; } else cur.push(c); });
      if (cur.length) groups.push(cur);
    }
  }
  const units = groups.filter(g => g.length).map(g => ({ chars: g, line: g[0].li, bbox: bboxOf(g, layout), segs: segments(g, layer) }));
  unitCache.set(layer.id + by, { key, units });
  return units;
}

// merge consecutive chars of the same run into strings (keeps kerning)
function segments(chars, layer) {
  const segs = [];
  const tracked = !!layer.tracking;
  for (const c of chars) {
    const last = segs[segs.length - 1];
    if (!tracked && last && last.run === c.run && last.li === c.li && last.next === c) {
      last.text += c.ch; last.next = nextChar(c, layer);
    } else segs.push({ text: c.ch, x: c.ax, y: c.by, run: c.run, li: c.li, next: nextChar(c, layer) });
  }
  return segs.map(({ next, ...s }) => s);
}
function nextChar(c, layer) {
  const l = layoutText(layer).lines[c.li];
  return l.chars[l.chars.indexOf(c) + 1];
}

// ---------- bounds (for selection / snapping) ----------
export function layerBounds(layer) {
  let w, h;
  if (layer.type === 'text') { const L = layoutText(layer); w = L.width; h = L.height; }
  else if (layer.type === 'image') { w = layer.width; h = layer.width * (layer.natH || 1) / (layer.natW || 1); }
  else { const r = Math.max(layer.lights.orb.on ? layer.lights.orb.size * 0.5 : 0, layer.lights.rays.on ? layer.lights.rays.length * 0.5 : 0, 60); w = h = r * 2; }
  const s = layer.scale || 1;
  return { cx: layer.x, cy: layer.y, w: w * s, h: h * s, x: layer.x - w * s / 2, y: layer.y - h * s / 2 };
}

// ---------- timing ----------
export function unitTiming(layer, spec, phase, i, n, unit, project) {
  const base = phase === 'in' ? 0 : project.sections.intro + project.sections.mid;
  const ord = orderIndex(i, n, spec.dir, hashId(layer.id));
  let ld = 0;
  if (layer.type === 'text' && layer.lines[unit.line]) ld = (phase === 'in' ? layer.lines[unit.line].delayIn : layer.lines[unit.line].delayOut) || 0;
  return base + (spec.start || 0) + ord * (spec.stagger || 0) + ld;
}
export function phaseSpan(layer, phase, project) {
  const spec = layer.anim[phase];
  if (!spec || spec.preset === 'none') return null;
  const P = PRESET[spec.preset] || PRESET.none;
  const by = (P.kind === 'particles' || P.kind === 'birds') ? 'all' : spec.by;
  const units = getUnits(layer, by);
  let a = Infinity, b = -Infinity;
  units.forEach((u, i) => { const s = unitTiming(layer, spec, phase, i, units.length, u, project); a = Math.min(a, s); b = Math.max(b, s + spec.duration); });
  return { start: a, end: b };
}
const hashCache = new Map();
export function hashId(id) {
  let h = hashCache.get(id);
  if (h === undefined) { h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; h %= 100000; hashCache.set(id, h); }
  return h;
}

// ---------- canvases ----------
const pool = [];
function layerCanvas(i, w, h) {
  let c = pool[i];
  if (!c) { c = document.createElement('canvas'); pool[i] = c; }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
  return [c, x];
}

const hexA = (hex, a) => {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1)})`;
};
const mixHex = (hex, toWhite) => {
  let h = (hex || '#ffffff').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const f = v => Math.round(v + (255 - v) * toWhite);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f).map(v => v.toString(16).padStart(2, '0')).join('');
};

// ---------- main entry ----------
// ctx canvas must be project.width*scale x project.height*scale
export function renderFrame(ctx, project, t, { scale = 1, background = false } = {}) {
  const W = Math.round(project.width * scale), H = Math.round(project.height * scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (background) drawBackground(ctx, project, W, H);
  project.layers.forEach((layer, i) => { if (layer.visible !== false) drawLayer(ctx, layer, project, t, scale, i, W, H); });
}

function drawBackground(ctx, project, W, H) {
  const bg = project.background || {};
  if (bg.mode === 'dark') { ctx.fillStyle = '#1b1b1f'; ctx.fillRect(0, 0, W, H); }
  else if (bg.mode === 'light') { ctx.fillStyle = '#f1ede6'; ctx.fillRect(0, 0, W, H); }
  else if (bg.mode === 'image' && bg.image) {
    const img = getImage(bg.image);
    if (img) { const s = Math.max(W / img.naturalWidth, H / img.naturalHeight); const w = img.naturalWidth * s, h = img.naturalHeight * s; ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
  }
}

function drawLayer(ctx, layer, project, t, scale, idx, W, H) {
  const { intro, mid } = project.sections;
  const outroStart = intro + mid;
  const phase = t >= outroStart ? 'out' : 'in';
  const spec = layer.anim[phase];
  const preset = PRESET[spec.preset] || PRESET.none;
  const tau = Math.max(0, t - intro);
  const m = midState(layer.anim.mid, tau);
  const seed = hashId(layer.id);

  // presence (0..1) for lights attached to the layer
  let presence = 1;
  const pin = phaseSpan(layer, 'in', project);
  if (pin) presence = EASES.outCubic(clamp((t - pin.start) / Math.max(0.01, pin.end - pin.start)));
  const pout = phaseSpan(layer, 'out', project);
  if (pout && t >= outroStart) presence = Math.min(presence, 1 - EASES.inCubic(clamp((t - pout.start) / Math.max(0.01, pout.end - pout.start))));

  const S = scale;
  const baseTransform = (c) => {
    c.setTransform(S, 0, 0, S, 0, 0);
    c.translate(layer.x + m.x, layer.y + m.y);
    c.rotate(((layer.rotation || 0) + m.r) * Math.PI / 180);
    c.scale((layer.scale || 1) * m.s, (layer.scale || 1) * m.s);
  };

  // ----- lights (behind) -----
  if (layer.lights && (layer.lights.orb.on || layer.lights.rays.on)) {
    ctx.save();
    baseTransform(ctx);
    let a = layer.opacity * m.o, ls = 1, blur = 0;
    if (layer.type === 'light') {
      if (preset.kind === 'particles' || preset.kind === 'birds') { a *= presence; ls = 0.6 + 0.4 * presence; }
      else {
        const u = getUnits(layer, 'all')[0];
        const st = phaseState(spec, phase, (t - unitTiming(layer, spec, phase, 0, 1, u, project)) / Math.max(0.001, spec.duration), 1, seed);
        ctx.translate(st.x, st.y); ctx.rotate(st.r * Math.PI / 180); ctx.scale(st.s * st.sx, st.s * st.sy);
        a *= st.o; blur = st.b; ls = st.radial;
      }
    } else { a *= presence; ls = 0.7 + 0.3 * presence; }
    a *= 1 + 0.35 * m.glow;
    if (a > 0.002) drawLights(ctx, layer.lights, a, ls, tau + t * 0, S * (layer.scale || 1) * m.s, blur, t);
    ctx.restore();
  }
  if (layer.type === 'light') return;

  // ----- content onto layer canvas -----
  const [lc, lx] = layerCanvas(idx, W, H);
  if (preset.kind === 'particles' || preset.kind === 'birds') {
    const start = unitTiming(layer, spec, phase, 0, 1, getUnits(layer, 'all')[0], project);
    let p = clamp((t - start) / Math.max(0.01, spec.duration));
    if (phase === 'in') p = 1 - p; // play the effect backwards to assemble
    if (p <= 0) drawContentRest(lx, layer, S, baseTransform);
    else if (p < 1) drawParticleEffect(lx, layer, project, S, p, preset.kind, spec.duration, seed, easeFor(spec, preset, phase === 'in' ? 'out' : phase));
  } else {
    const units = getUnits(layer, layer.type === 'image' ? 'all' : spec.by);
    const n = units.length;
    baseTransform(lx);
    for (let i = 0; i < n; i++) {
      const u = units[i];
      let p = 1;
      if (preset.id !== 'none') p = (t - unitTiming(layer, spec, phase, i, n, u, project)) / Math.max(0.001, spec.duration);
      const st = phaseState(spec, phase, p, i + 1, seed);
      if (layer.anim.mid.preset === 'wave') st.y += midState(layer.anim.mid, tau, i, n).y;
      if (st.o <= 0.002 || st.wipe <= 0.001 || st.radial <= 0.001) continue;
      drawUnit(lx, layer, u, st, S * (layer.scale || 1) * m.s, preset);
    }
  }
  // shimmer
  if (m.shimmer >= 0) {
    const b = layerBounds(layer);
    lx.save(); lx.setTransform(S, 0, 0, S, 0, 0);
    lx.globalCompositeOperation = 'source-atop';
    const span = b.w + b.h;
    const pos = b.x - b.h + m.shimmer * (span + b.h * 2);
    const g = lx.createLinearGradient(pos - b.h * 0.6, b.y, pos + b.h * 0.6, b.y + b.h);
    const col = layer.anim.mid.color || '#FFF6DC', amt = clamp(0.75 * (layer.anim.mid.amount ?? 1), 0, 1);
    g.addColorStop(0, hexA(col, 0)); g.addColorStop(0.5, hexA(col, amt)); g.addColorStop(1, hexA(col, 0));
    lx.fillStyle = g; lx.fillRect(b.x - b.w, b.y - b.h, b.w * 3, b.h * 3);
    lx.restore();
  }

  // ----- composite with shadow & glow -----
  const alpha = clamp(layer.opacity * m.o);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const OFF = W * 4;
  const sh = layer.shadow;
  if (sh && sh.on && sh.opacity > 0) {
    ctx.globalAlpha = alpha;
    ctx.shadowColor = hexA(sh.color, sh.opacity);
    ctx.shadowBlur = sh.blur * S;
    ctx.shadowOffsetX = OFF + sh.x * S; ctx.shadowOffsetY = sh.y * S;
    ctx.drawImage(lc, -OFF, 0);
  }
  if (m.glow > 0.01) {
    const col = layer.anim.mid.color || '#FFE7A8';
    ctx.globalAlpha = alpha;
    ctx.shadowColor = hexA(col, clamp(0.9 * m.glow));
    ctx.shadowBlur = (18 + 40 * m.glow) * S;
    ctx.shadowOffsetX = OFF; ctx.shadowOffsetY = 0;
    ctx.drawImage(lc, -OFF, 0);
  }
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.globalAlpha = alpha;
  ctx.drawImage(lc, 0, 0);
  ctx.restore();
}

function drawContentRest(lx, layer, S, baseTransform) {
  baseTransform(lx);
  const units = getUnits(layer, 'all');
  for (const u of units) drawUnit(lx, layer, u, { ...REST }, S * (layer.scale || 1), PRESET.none);
}

function drawUnit(c, layer, u, st, effScale, preset) {
  const b = u.bbox;
  c.save();
  const spreadDx = b.cx * (st.spread || 0);
  c.translate(b.cx + st.x + spreadDx, b.cy + st.y);
  if (st.r) c.rotate(st.r * Math.PI / 180);
  if (st.sk) c.transform(1, 0, Math.tan(st.sk * Math.PI / 180), 1, 0, 0);
  c.scale(st.s * st.sx, st.s * st.sy);
  c.translate(-b.cx, -b.cy);
  c.globalAlpha = clamp(st.o);
  if (st.b > 0.25) c.filter = `blur(${(st.b * effScale).toFixed(2)}px)`;
  if (layer.type === 'image') {
    const img = getImage(layer.src);
    if (img) c.drawImage(tinted(img, layer.tint), b.x, b.y, b.w, b.h);
  } else {
    c.textBaseline = 'alphabetic';
    for (const s of u.segs) { c.font = fontStr(s.run); c.fillStyle = s.run.color; c.fillText(s.text, s.x, s.y); }
  }
  c.filter = 'none';
  // soft-edged wipe / radial reveal: erase what is not yet revealed
  if (st.wipe < 0.999 || st.radial < 0.999) {
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'destination-out';
    const pad = Math.max(b.w, b.h) * 0.6 + 40;
    if (st.wipe < 0.999) {
      const dir = preset.wipeDir || 'right';
      const f = Math.max(14, (dir === 'up' ? b.h : b.w) * 0.12);
      let g;
      if (dir === 'up') {
        const edge = b.y + b.h + f - (b.h + 2 * f) * st.wipe;
        g = c.createLinearGradient(0, edge + f, 0, edge - f);
      } else {
        const edge = b.x - f + (b.w + 2 * f) * st.wipe;
        g = c.createLinearGradient(edge - f, 0, edge + f, 0);
      }
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
      c.fillStyle = g; c.fillRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
    }
    if (st.radial < 0.999) {
      const R = Math.hypot(b.w, b.h) / 2, f = Math.max(16, R * 0.18);
      const edge = (R + f) * st.radial;
      const g = c.createRadialGradient(b.cx, b.cy, Math.max(0, edge - f), b.cx, b.cy, edge + f);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
      c.fillStyle = g; c.fillRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
    }
    c.globalCompositeOperation = 'source-over';
  }
  c.restore();
}

// ---------- lights ----------
function drawLights(c, lights, alpha, ls, tau, effScale, blur, t) {
  const { orb, rays } = lights;
  if (rays.on && rays.intensity > 0 && rays.count > 0) {
    c.save();
    c.translate(rays.x || 0, rays.y || 0);
    c.scale(ls, ls);
    const soft = (rays.softness || 0) + blur;
    if (soft > 0.25) c.filter = `blur(${(soft * effScale).toFixed(2)}px)`;
    const n = Math.round(rays.count), spread = clamp(rays.spread, 1, 360);
    const rot = (rays.direction || 0) + (rays.turn || 0) * t;
    const slot = spread >= 360 ? 360 / n : spread / Math.max(1, n);
    const w = slot * clamp(rays.width, 0.02, 1);
    const inner = Math.max(0, rays.inner || 0);
    for (let i = 0; i < n; i++) {
      const a = spread >= 360 ? rot + i * 360 / n : rot - spread / 2 + slot * (i + 0.5);
      const L = rays.length * (0.82 + 0.18 * Math.sin(t * 0.9 + i * 2.17)) * (i % 2 ? 0.86 : 1);
      if (L <= inner) continue;
      const a0 = (a - w / 2 - 90) * Math.PI / 180, a1 = (a + w / 2 - 90) * Math.PI / 180;
      const g = c.createRadialGradient(0, 0, inner, 0, 0, L);
      g.addColorStop(0, hexA(rays.color, alpha * rays.intensity));
      g.addColorStop(0.35, hexA(rays.color, alpha * rays.intensity * 0.55));
      g.addColorStop(1, hexA(rays.color, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, L, a0, a1); c.arc(0, 0, inner, a1, a0, true); c.closePath(); c.fill();
    }
    c.restore();
  }
  if (orb.on && orb.intensity > 0) {
    c.save();
    c.translate(orb.x || 0, orb.y || 0);
    if (blur > 0.25) c.filter = `blur(${(blur * effScale).toFixed(2)}px)`;
    const R = orb.size * ls, I = orb.intensity * alpha;
    const core = mixHex(orb.color, clamp(orb.core ?? 0.5));
    const g = c.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, hexA(core, I));
    g.addColorStop(0.08, hexA(core, I * 0.92));
    g.addColorStop(0.2, hexA(orb.color, I * 0.62));
    g.addColorStop(0.4, hexA(orb.color, I * 0.3));
    g.addColorStop(0.65, hexA(orb.color, I * 0.1));
    g.addColorStop(1, hexA(orb.color, 0));
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.restore();
  }
}

// ---------- particles & birds ----------
function restRender(layer, project, S) {
  const key = layer.id + '|' + S + '|' + JSON.stringify([layer.lines, layer.src, layer.tint, layer.width, layer.x, layer.y, layer.scale, layer.rotation, layer.align, layer.lineHeight, layer.tracking, fontVersion]);
  const hit = restCache.get(layer.id + '|' + S);
  if (hit && hit.key === key) return hit.data;
  const W = Math.round(project.width * S), H = Math.round(project.height * S);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d', { willReadFrequently: true });
  drawContentRest(x, layer, S, (c) => { c.setTransform(S, 0, 0, S, 0, 0); c.translate(layer.x, layer.y); c.rotate((layer.rotation || 0) * Math.PI / 180); c.scale(layer.scale || 1, layer.scale || 1); });
  const b = layerBounds(layer);
  const pad = 30 * S;
  const bx = Math.max(0, Math.floor(b.x * S - pad)), by = Math.max(0, Math.floor(b.y * S - pad));
  const bw = Math.min(W - bx, Math.ceil(b.w * S + pad * 2)), bh = Math.min(H - by, Math.ceil(b.h * S + pad * 2));
  const parts = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  if (bw > 0 && bh > 0) {
    const data = x.getImageData(bx, by, bw, bh).data;
    const step = Math.max(2, Math.round(Math.sqrt(bw * bh / 9000)));
    for (let yy = 0; yy < bh; yy += step) for (let xx = 0; xx < bw; xx += step) {
      const k = (yy * bw + xx) * 4;
      if (data[k + 3] > 90) {
        const px = bx + xx, py = by + yy;
        parts.push({ x: px, y: py, c: `rgba(${data[k]},${data[k + 1]},${data[k + 2]},`, a: data[k + 3] / 255, sd: parts.length });
        minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
    }
    var step_ = step;
  }
  let col = '#ffffff';
  if (layer.type === 'text') col = layer.lines[0]?.runs[0]?.color || col; else if (layer.tint) col = layer.tint;
  else if (parts.length) { const p = parts[Math.floor(parts.length / 2)]; col = p.c + '1)'; }
  const data = { canvas: cv, parts, minX, maxX, minY, maxY, step: step_ || 2, color: col };
  restCache.set(layer.id + '|' + S, { key, data });
  return data;
}

function drawParticleEffect(c, layer, project, S, p, kind, dur, seed, ease) {
  const R = restRender(layer, project, S);
  if (!R.parts.length) return;
  const w = Math.max(1, R.maxX - R.minX), h = Math.max(1, R.maxY - R.minY);
  const birds = kind === 'birds';
  // dissolve sweep: how far across the text has turned to particles
  const sweepP = birds ? clamp(p / 0.32) : clamp(ease(p) / 0.6);
  const f = Math.max(20 * S, w * 0.08);
  // remaining solid content, soft edged
  if (sweepP < 1) {
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(R.canvas, 0, 0);
    c.globalCompositeOperation = 'destination-out';
    const edge = R.minX - f + (w + 2 * f) * sweepP;
    const g = c.createLinearGradient(edge + f, 0, edge - f, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = g; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    c.restore();
  }
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  const sz = R.step * 0.95;
  if (!birds) {
    for (const q of R.parts) {
      const rel = (q.x - R.minX) / w;
      const tr = rel * 0.6 + rand(q.sd + seed) * 0.08;
      const a = clamp((ease(p) - tr) / 0.4);
      if (a <= 0) continue;
      const r1 = rand(q.sd * 3 + 1), r2 = rand(q.sd * 7 + 2), r3 = rand(q.sd * 11 + 5);
      const ea = EASES.outQuad(a);
      const dx = (60 + 260 * r1) * ea * S + Math.sin(a * 6 + r3 * 6) * 14 * S * a;
      const dy = -(80 + 320 * r2) * ea * S;
      const al = Math.pow(1 - a, 1.3) * q.a;
      if (al < 0.01) continue;
      c.fillStyle = q.c + al.toFixed(3) + ')';
      const s = sz * (1 - 0.55 * a);
      c.fillRect(q.x + dx - s / 2, q.y + dy - s / 2, s, s);
    }
    c.restore();
    return;
  }
  // ---- birds ----
  const K = Math.max(3, Math.min(9, Math.round(w / (170 * S)) + 1));
  const flock = [];
  const arrive = k => ((k + 0.5) / K) * 0.26 + 0.24; // when bird k's particles have gathered
  for (let k = 0; k < K; k++) {
    const rk = n => rand(seed * 13 + k * 101 + n);
    const ar = arrive(k);
    const sx = R.minX + w * ((k + 0.5) / K) + (rk(1) - 0.5) * w / K * 0.5;
    const sy = R.minY + h * 0.5 + (rk(2) - 0.5) * h * 0.6 - 40 * S;
    const lt = clamp((p - ar) / (1 - ar));
    const dirX = rk(3) > 0.35 ? 1 : -1;
    const fx = sx + dirX * Math.pow(lt, 1.5) * (900 + 900 * rk(4)) * S + Math.sin(lt * 9 + k) * 30 * S * lt;
    const fy = sy - Math.pow(lt, 1.25) * (1100 + 900 * rk(5)) * S + Math.sin(lt * 7 + k * 2) * 24 * S;
    const grow = EASES.outCubic(clamp((p - ar + 0.06) / 0.1));
    const size = (62 + 34 * rk(6)) * S * grow * (1 - 0.45 * lt);
    const flapHz = 2.4 + rk(7) * 1.2;
    const flap = Math.sin((p * dur) * Math.PI * 2 * flapHz + rk(8) * 6);
    const alpha = clamp((p - ar + 0.06) / 0.08) * (1 - clamp((p - 0.86) / 0.14));
    const heading = Math.atan2(-(1100 + 900 * rk(5)), dirX * (900 + 900 * rk(4))) + Math.PI / 2;
    flock.push({ sx, sy, fx, fy, size, flap, alpha, heading: heading * 0.35 * clamp(lt * 4), ar });
  }
  // particles flowing into birds
  for (const q of R.parts) {
    const rel = (q.x - R.minX) / w;
    const tr = rel * 0.26;
    const a = clamp((p - tr) / 0.12);
    if (a <= 0) continue;
    const k = Math.min(K - 1, Math.floor(rel * K));
    const B = flock[k];
    const toward = EASES.inOutCubic(clamp((p - tr) / Math.max(0.05, B.ar - tr)));
    const ox = (rand(q.sd * 5 + 3) - 0.5) * 40 * S * (1 - toward), oy = (rand(q.sd * 9 + 4) - 0.5) * 20 * S * (1 - toward);
    const x0 = q.x + Math.sin(a * 5 + q.sd) * 10 * S * a, y0 = q.y - 24 * S * a;
    const x = lerp(x0, B.fx, toward) + ox, y = lerp(y0, B.fy, toward) + oy;
    const al = q.a * (1 - clamp((p - B.ar + 0.03) / 0.06));
    if (al < 0.01) continue;
    c.fillStyle = q.c + al.toFixed(3) + ')';
    const s = sz * (1 - 0.3 * toward);
    c.fillRect(x - s / 2, y - s / 2, s, s);
  }
  c.fillStyle = R.color;
  for (const B of flock) {
    if (B.alpha <= 0.01 || B.size <= 0.5) continue;
    c.globalAlpha = B.alpha;
    drawBird(c, B.fx, B.fy, B.size, B.flap, B.heading);
  }
  c.restore();
}

export function drawBird(c, x, y, s, flap, heading = 0) {
  c.save(); c.translate(x, y); c.rotate(heading);
  const wy = -flap * s * 0.55;
  c.beginPath();
  c.moveTo(0, -s * 0.02);
  c.bezierCurveTo(-s * 0.22, wy * 0.35 - s * 0.2, -s * 0.6, wy * 0.8 - s * 0.12, -s, wy);
  c.bezierCurveTo(-s * 0.62, wy * 0.6 + s * 0.02, -s * 0.3, wy * 0.2 + s * 0.06, -s * 0.05, s * 0.1);
  c.lineTo(0, s * 0.2);
  c.lineTo(s * 0.05, s * 0.1);
  c.bezierCurveTo(s * 0.3, wy * 0.2 + s * 0.06, s * 0.62, wy * 0.6 + s * 0.02, s, wy);
  c.bezierCurveTo(s * 0.6, wy * 0.8 - s * 0.12, s * 0.22, wy * 0.35 - s * 0.2, 0, -s * 0.02);
  c.closePath(); c.fill();
  c.beginPath(); c.ellipse(0, s * 0.04, s * 0.06, s * 0.17, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}
