// Toolkit for custom effects (code layers). Claude writes code that runs every frame as
//   function (ctx, t, lib) { ... }
// ctx is a 2D canvas context set up in project pixels (W x H). Everything must depend only on t,
// so preview and export match frame for frame.
import { EASES, clamp, lerp, rand } from './anims.js';

let deps = null; // { getImage, fontStr, withBlur, fontVersion }
export function setCodeDeps(d) { deps = d; }

let symbolIndex = {}; // name -> { gold, white, black } paths
export function setSymbolIndex(manifest) {
  symbolIndex = {};
  for (const s of manifest || []) {
    const parts = s.file.split('/');
    const colour = parts.length > 1 ? parts[0] : 'gold';
    const name = parts[parts.length - 1].replace(/\.(png|svg|webp)$/i, '');
    (symbolIndex[name] ||= {})[colour] = 'symbols/' + s.file;
  }
}
export const symbolNames = () => Object.keys(symbolIndex);
export function symbolPath(name, colour = 'gold') {
  const key = String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const e = symbolIndex[key] || symbolIndex[Object.keys(symbolIndex).find(k => k.includes(key) || key.includes(k)) || ''];
  if (!e) return null;
  return e[colour] || e.gold || Object.values(e)[0];
}

// ---------- caches (cleared when fonts change) ----------
const pointCache = new Map(), pieceCache = new Map();
export function clearCodeCaches() { pointCache.clear(); pieceCache.clear(); }

const hexRGB = (hex) => { let h = String(hex || '#fff').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h.slice(0, 6), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (hex, a) => { const [r, g, b] = hexRGB(hex); return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`; };

// smooth value noise
function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(rand(i * 7 + 3), rand((i + 1) * 7 + 3), u) * 2 - 1; }
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => rand(a * 374761 + b * 668265 + 11);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v) * 2 - 1;
}

// ---------- shapes ----------
function shapePath(ctx, name, x, y, size, opt = {}) {
  const s = size / 2;
  ctx.beginPath();
  switch (name) {
    case 'heart': {
      const top = y - s * 0.55;
      ctx.moveTo(x, y + s * 0.95);
      ctx.bezierCurveTo(x - s * 0.15, y + s * 0.78, x - s * 1.0, y + s * 0.25, x - s * 1.0, y - s * 0.3);
      ctx.bezierCurveTo(x - s * 1.0, y - s * 0.85, x - s * 0.35, y - s * 1.05, x, top);
      ctx.bezierCurveTo(x + s * 0.35, y - s * 1.05, x + s * 1.0, y - s * 0.85, x + s * 1.0, y - s * 0.3);
      ctx.bezierCurveTo(x + s * 1.0, y + s * 0.25, x + s * 0.15, y + s * 0.78, x, y + s * 0.95);
      break;
    }
    case 'star': {
      const n = opt.points || 5, inner = opt.inner ?? 0.45;
      for (let i = 0; i < n * 2; i++) { const r = i % 2 ? s * inner : s, a = -Math.PI / 2 + i * Math.PI / n; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); }
      ctx.closePath(); break;
    }
    case 'drop': ctx.moveTo(x, y - s); ctx.bezierCurveTo(x + s * 0.2, y - s * 0.55, x + s * 0.75, y - s * 0.05, x + s * 0.75, y + s * 0.3); ctx.arc(x, y + s * 0.3, s * 0.75, 0, Math.PI); ctx.bezierCurveTo(x - s * 0.75, y - s * 0.05, x - s * 0.2, y - s * 0.55, x, y - s); break;
    case 'moon': ctx.arc(x, y, s, Math.PI * 0.5, Math.PI * 1.5); ctx.arc(x - s * 0.35, y, s * 0.85, Math.PI * 1.5, Math.PI * 0.5, true); break;
    case 'diamond': ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.7, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.7, y); ctx.closePath(); break;
    case 'ring': ctx.arc(x, y, s, 0, Math.PI * 2); ctx.arc(x, y, s * (opt.inner ?? 0.8), 0, Math.PI * 2, true); break;
    case 'sun': { const n = opt.points || 12; for (let i = 0; i <= n * 2; i++) { const r = i % 2 ? s * 0.78 : s, a = -Math.PI / 2 + i * Math.PI / n; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); break; }
    case 'circle': default: ctx.arc(x, y, s, 0, Math.PI * 2);
  }
}

// ---------- offscreen render of a drawFn (for points/shatter) ----------
function renderOff(W, H, S, drawFn) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W * S)); c.height = Math.max(1, Math.round(H * S));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.setTransform(S, 0, 0, S, 0, 0);
  drawFn(x);
  return c;
}
function alphaBox(c) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  const step = 2;
  for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) if (d[(y * c.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, data: d };
}

// ---------- the lib handed to each effect ----------
export function makeLib(ctx, project, S) {
  const W = project.width, H = project.height;
  const { intro, mid, outro } = project.sections;
  const total = intro + mid + outro;
  const lib = {
    W, H, cx: W / 2, cy: H / 2,
    T: { intro, mid, outro, total, midStart: intro, outroStart: intro + mid },
    ease: EASES, clamp, lerp, rand: (i) => rand(Math.floor(i * 1000) + 7), noise: (x, y) => y === undefined ? noise1(x) : noise2(x, y),
    // progress 0..1 of t between a and b, optionally eased
    seg(t, a, b, ease) { const p = clamp((t - a) / Math.max(1e-6, b - a)); return ease ? (EASES[ease] || EASES.outCubic)(p) : p; },
    mix(c1, c2, p) { const a = hexRGB(c1), b = hexRGB(c2); return '#' + a.map((v, i) => Math.round(lerp(v, b[i], clamp(p))).toString(16).padStart(2, '0')).join(''); },
    rgba,
    // Jess's standard soft, centred, subtle drop shadow (call before drawing; lib.noShadow() after)
    shadow(opacity = 0.4, blur = 30) { ctx.shadowColor = `rgba(0,0,0,${opacity})`; ctx.shadowBlur = blur * S; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
    noShadow() { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; },
    font(o = {}) { return deps.fontStr({ font: o.font || 'Cormorant Garamond', weight: o.weight || 500, italic: !!o.italic, size: o.size || 96 }); },
    measure(str, o = {}) { ctx.save(); ctx.font = lib.font(o); const w = ctx.measureText(str).width + (o.tracking || 0) * (o.size || 96) / 1000 * Math.max(0, [...str].length - 1); ctx.restore(); return w; },
    // draw text centred (default) at x, y (y = baseline)
    text(str, x, y, o = {}) {
      ctx.save();
      ctx.font = lib.font(o); ctx.fillStyle = o.color || '#FFFFFF'; ctx.textBaseline = o.baseline || 'alphabetic';
      if (o.gradient) { // metallic / gradient fill across the text, e.g. gradient: 'gold' or ['#8C6420','#F3DC9A','#B8892A']
        const stops = o.gradient === 'gold' ? ['#9A7124', '#E9CF8A', '#B8892A', '#F6E3A8', '#A57C2C'] : o.gradient;
        const w0 = lib.measure(str, o), sz = o.size || 96;
        const gx = o.align === 'left' ? x : o.align === 'right' ? x - w0 : x - w0 / 2;
        const g = ctx.createLinearGradient(gx, y - sz * 0.8, gx + w0 * 0.35, y + sz * 0.3);
        stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
        ctx.fillStyle = g;
      }
      if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
      if (o.shadow) lib.shadow(typeof o.shadow === 'number' ? o.shadow : 0.4);
      const tr = (o.tracking || 0) * (o.size || 96) / 1000;
      const w = lib.measure(str, o);
      let sx = o.align === 'left' ? x : o.align === 'right' ? x - w : x - w / 2;
      if (!tr) ctx.fillText(str, sx, y);
      else { let pre = ''; for (const ch of [...str]) { ctx.fillText(ch, sx + ctx.measureText(pre).width + tr * [...pre].length, y); pre += ch; } }
      ctx.restore();
      return w;
    },
    // Will and the Way symbols: lib.symbol('path-and-purpose', 'gold'|'white'|'black') -> image or null while loading
    symbol(name, colour = 'gold') { const p = symbolPath(name, colour); const img = p ? deps.getImage(p) : null; if (p && !img) lib._missing = true; return img; },
    drawSymbol(name, x, y, size, o = {}) {
      const img = lib.symbol(name, o.colour || o.color || 'gold'); if (!img) return;
      const ar = (img.naturalHeight || 1) / (img.naturalWidth || 1);
      ctx.save(); ctx.translate(x, y); if (o.rotate) ctx.rotate(o.rotate); if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
      if (o.shadow) lib.shadow(typeof o.shadow === 'number' ? o.shadow : 0.4);
      ctx.drawImage(img, -size / 2, -size * ar / 2, size, size * ar); ctx.restore();
    },
    // adds a path; then ctx.fill() / ctx.stroke(). names: heart, star, circle, drop, moon, diamond, ring, sun
    shape(name, x, y, size, opt) { shapePath(ctx, name, x, y, size, opt); },
    // soft glowing orb of light
    glow(x, y, radius, color = '#FFD98A', intensity = 0.8, core = 0.5) {
      if (radius <= 0 || intensity <= 0) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const c2 = lib.mix(color, '#FFFFFF', core);
      g.addColorStop(0, rgba(c2, intensity)); g.addColorStop(0.1, rgba(c2, intensity * 0.9)); g.addColorStop(0.25, rgba(color, intensity * 0.55));
      g.addColorStop(0.5, rgba(color, intensity * 0.2)); g.addColorStop(0.75, rgba(color, intensity * 0.06)); g.addColorStop(1, rgba(color, 0));
      ctx.save(); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    },
    // rays of light from a point. o: {count, length, width (0..1), color, intensity, rotation (radians), spread (degrees, 360=all round), inner, softness}
    rays(x, y, o = {}) {
      const n = o.count ?? 14, L = o.length ?? 500, inner = o.inner ?? 30, spread = clamp(o.spread ?? 360, 1, 360), I = o.intensity ?? 0.6, col = o.color || '#FFE3A0';
      if (I <= 0 || L <= inner) return;
      ctx.save(); ctx.translate(x, y);
      deps.withBlur(ctx, (o.softness ?? 8) * S, (c) => {
        const slot = spread >= 360 ? 360 / n : spread / n, w = slot * clamp(o.width ?? 0.35, 0.02, 1);
        for (let i = 0; i < n; i++) {
          const a = (o.rotation || 0) * 180 / Math.PI + (spread >= 360 ? i * slot : -spread / 2 + slot * (i + 0.5));
          const len = L * (o.even ? 1 : (i % 2 ? 0.82 : 1));
          const a0 = (a - w / 2 - 90) * Math.PI / 180, a1 = (a + w / 2 - 90) * Math.PI / 180;
          const g = c.createRadialGradient(0, 0, inner, 0, 0, len);
          g.addColorStop(0, rgba(col, I)); g.addColorStop(0.35, rgba(col, I * 0.5)); g.addColorStop(1, rgba(col, 0));
          c.fillStyle = g; c.beginPath(); c.arc(0, 0, len, a0, a1); c.arc(0, 0, inner, a1, a0, true); c.closePath(); c.fill();
        }
      });
      ctx.restore();
    },
    // a flash of light: p 0..1 over the burst (rises fast, fades slowly)
    burst(x, y, p, o = {}) {
      if (p <= 0 || p >= 1) return;
      const k = p < 0.25 ? EASES.outCubic(p / 0.25) : 1 - EASES.inOutSine((p - 0.25) / 0.75);
      const R = (o.size ?? 520) * (0.6 + 0.6 * EASES.outCubic(p));
      lib.glow(x, y, R, o.color || '#FFD36B', (o.intensity ?? 1) * k, 0.7);
      lib.rays(x, y, { count: o.count ?? 18, length: R * 1.4, width: 0.22, color: o.color || '#FFE3A0', intensity: 0.7 * k * (o.intensity ?? 1), rotation: p * 0.6, softness: 10 });
    },
    blur(px, drawFn) { deps.withBlur(ctx, px * S, drawFn); },
    // twinkling glints/stars scattered in a box. o: {count, color, size, speed, seed}
    sparkles(x, y, w, h, tt, o = {}) {
      const n = o.count ?? 40, col = o.color || '#FFF3D0', sz = o.size ?? 14, sp = o.speed ?? 1, sd = o.seed ?? 1;
      ctx.save();
      for (let i = 0; i < n; i++) {
        const px = x + rand(i * 11 + sd) * w, py = y + rand(i * 23 + sd * 3) * h;
        const ph = rand(i * 37 + sd * 5) * Math.PI * 2, f = 0.6 + rand(i * 53) * 0.9;
        const tw = Math.max(0, Math.sin(tt * sp * f * 2.2 + ph)); const a = Math.pow(tw, 3) * (o.alpha ?? 1);
        if (a < 0.02) continue;
        const r = sz * (0.4 + rand(i * 71) * 0.8) * (0.6 + 0.4 * tw);
        const g = ctx.createRadialGradient(px, py, 0, px, py, r * 0.9);
        g.addColorStop(0, rgba('#FFFFFF', a)); g.addColorStop(0.3, rgba(col, a * 0.6)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r * 0.9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba('#FFFFFF', a * 0.8); ctx.lineWidth = Math.max(0.6, r * 0.06); ctx.beginPath();
        ctx.moveTo(px - r * 1.6, py); ctx.lineTo(px + r * 1.6, py); ctx.moveTo(px, py - r * 1.6); ctx.lineTo(px, py + r * 1.6); ctx.stroke();
      }
      ctx.restore();
    },
    // sample what drawFn draws into particle points: [{x,y,c:'r,g,b',a}], cached by key
    points(key, drawFn, step = 4) {
      const k = key + '|' + step + '|' + W + 'x' + H + '|' + deps.fontVersion();
      let pts = pointCache.get(k);
      if (!pts) {
        lib._missing = false;
        const c = renderOff(W, H, 1, drawFn);
        const b = alphaBox(c); pts = [];
        if (b) for (let y = b.y; y < b.y + b.h; y += step) for (let x = b.x; x < b.x + b.w; x += step) {
          const i = (y * c.width + x) * 4; if (b.data[i + 3] > 80) pts.push({ x, y, c: `${b.data[i]},${b.data[i + 1]},${b.data[i + 2]}`, a: b.data[i + 3] / 255 });
        }
        if (!lib._missing) pointCache.set(k, pts);
      }
      return pts;
    },
    // particles flowing from one point set to another. p 0..1. o: {size, swirl, color (override), sort}
    morph(fromPts, toPts, p, o = {}) {
      if (!fromPts?.length || !toPts?.length) return;
      const order = (a) => [...a].sort((u, v) => (u.x * 0.8 + u.y * 0.35) - (v.x * 0.8 + v.y * 0.35));
      const key = fromPts.length + ':' + toPts.length;
      const A = o._A || order(fromPts), B = o._B || order(toPts);
      const n = Math.min(4500, Math.max(A.length, B.length));
      const sz = o.size ?? 2.6, swirl = o.swirl ?? 120;
      ctx.save();
      for (let i = 0; i < n; i++) {
        const a = A[Math.floor(i * A.length / n)], b = B[Math.floor(i * B.length / n)];
        const r = rand(i * 13 + 5), d = clamp((p - r * 0.25) / 0.75);
        const e = EASES.inOutCubic(d);
        const bend = Math.sin(e * Math.PI) * swirl * (rand(i * 7 + 1) - 0.5) * 2;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const x = lerp(a.x, b.x, e) - dy / len * bend, y = lerp(a.y, b.y, e) + dx / len * bend;
        const alpha = lerp(a.a, b.a, e) * (o.alpha ?? 1);
        if (o.color) ctx.fillStyle = rgba(o.color, alpha);
        else { const ca = a.c.split(',').map(Number), cb = b.c.split(',').map(Number); ctx.fillStyle = `rgba(${ca.map((v, j) => Math.round(lerp(v, cb[j], e))).join(',')},${alpha.toFixed(3)})`; }
        const s = sz * (1 + Math.sin(e * Math.PI) * 0.6);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
      ctx.restore();
    },
    // particles drifting away (p 0..1). o: {dir:'up'|'right'|'out', distance, size}
    disperse(pts, p, o = {}) {
      if (!pts?.length || p <= 0) return;
      const n = Math.min(5000, pts.length), D = o.distance ?? 260, sz = o.size ?? 2.4;
      let cx = 0, cy = 0; for (const q of pts) { cx += q.x; cy += q.y; } cx /= pts.length; cy /= pts.length;
      ctx.save();
      for (let i = 0; i < n; i++) {
        const q = pts[Math.floor(i * pts.length / n)], r1 = rand(i * 3 + 1), r2 = rand(i * 5 + 2);
        const d = clamp((p - r1 * 0.35) / 0.65); if (d <= 0) { ctx.fillStyle = `rgba(${q.c},${q.a})`; ctx.fillRect(q.x - sz / 2, q.y - sz / 2, sz, sz); continue; }
        const e = EASES.outQuad(d);
        let vx, vy;
        if (o.dir === 'out') { const ang = Math.atan2(q.y - cy, q.x - cx) + (r2 - 0.5) * 0.6; vx = Math.cos(ang); vy = Math.sin(ang); }
        else if (o.dir === 'right') { vx = 0.8 + r2 * 0.6; vy = -0.3 - r1 * 0.4; }
        else { vx = (r2 - 0.5) * 0.8; vy = -0.6 - r1 * 0.8; }
        const x = q.x + vx * D * e + noise1(i * 0.3 + d * 3) * 12 * d, y = q.y + vy * D * e;
        const a = q.a * Math.pow(1 - d, 1.2); if (a < 0.01) continue;
        ctx.fillStyle = `rgba(${o.color ? hexRGB(o.color).join(',') : q.c},${a.toFixed(3)})`;
        const s = sz * (1 - 0.5 * d); ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
      ctx.restore();
    },
    // draw something broken into jagged pieces. p = 0 fully apart, p = 1 whole (crack closes).
    // o: {pieces (2 = a clean split down the middle, more = shards), spread px, rotate (radians), crack (crack line colour while apart), jag}
    shatter(key, drawFn, p, o = {}) {
      const pieces = Math.max(2, o.pieces || 2);
      const k = key + '|' + pieces + '|' + (o.jag ?? 1) + '|' + S + '|' + deps.fontVersion();
      let P = pieceCache.get(k);
      if (!P) {
        lib._missing = false;
        const c = renderOff(W, H, S, drawFn);
        const b = alphaBox(c);
        if (!b || lib._missing) return;
        const bx = b.x / S, by = b.y / S, bw = b.w / S, bh = b.h / S, cx = bx + bw / 2, cy = by + bh / 2;
        const jag = (o.jag ?? 1) * Math.min(bw, bh) * 0.07;
        const crack = (x0, y0, x1, y1, seed) => { const pts = []; const n = 9; for (let i = 0; i <= n; i++) { const f = i / n; const j = (i === 0 || i === n) ? 0 : (rand(seed * 31 + i) - 0.5) * 2 * jag; const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1; pts.push([x0 + dx * f - dy / L * j, y0 + dy * f + dx / L * j]); } return pts; };
        const polys = [];
        const R = Math.hypot(bw, bh);
        if (pieces === 2) {
          const line = crack(cx + bw * 0.02, by - 4, cx - bw * 0.02, by + bh + 4, 3);
          polys.push({ pts: [[cx - R, by - R], ...line, [cx - R, by + bh + R]], dir: [-1, 0] });
          polys.push({ pts: [[cx + R, by - R], ...line, [cx + R, by + bh + R]], dir: [1, 0] });
        } else {
          const rays = []; for (let i = 0; i < pieces; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / pieces + (rand(i * 17) - 0.5) * 0.5; rays.push(crack(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R, i + 1)); }
          for (let i = 0; i < pieces; i++) {
            const r1 = rays[i], r2 = rays[(i + 1) % pieces];
            const mid = -Math.PI / 2 + (i + 0.5) * Math.PI * 2 / pieces;
            polys.push({ pts: [...r1, ...[...r2].reverse()], dir: [Math.cos(mid), Math.sin(mid)] });
          }
        }
        P = { canvas: c, polys, cx, cy };
        pieceCache.set(k, P);
      }
      const apart = 1 - clamp(p);
      const spread = o.spread ?? 90;
      ctx.save();
      P.polys.forEach((poly, i) => {
        const ox = poly.dir[0] * spread * apart, oy = poly.dir[1] * spread * apart + (o.drop ?? 0) * apart;
        const rot = (o.rotate ?? 0.18) * apart * (i % 2 ? 1 : -1) * (0.6 + rand(i * 5) * 0.8);
        ctx.save();
        ctx.translate(P.cx + ox, P.cy + oy); ctx.rotate(rot); ctx.translate(-P.cx, -P.cy);
        ctx.beginPath(); poly.pts.forEach(([x, y], j) => ctx[j ? 'lineTo' : 'moveTo'](x, y)); ctx.closePath(); ctx.clip();
        ctx.drawImage(P.canvas, 0, 0, W, H);
        ctx.restore();
      });
      ctx.restore();
    },
  };
  return lib;
}

// ---------- compile ----------
const fnCache = new Map();
export function compileEffect(layer) {
  const src = layer.code || '';
  const hit = fnCache.get(layer.id);
  if (hit && hit.src === src) return hit;
  let entry;
  try {
    // Effects are written by Claude for this studio; run as a plain function of (ctx, t, lib).
    const fn = new Function('ctx', 't', 'lib', '"use strict";\n' + src);
    entry = { src, fn, error: null };
  } catch (e) { entry = { src, fn: null, error: 'Code error: ' + e.message }; }
  fnCache.set(layer.id, entry);
  return entry;
}
export function effectError(layer) { return fnCache.get(layer.id)?.error || null; }
export function setEffectError(layer, msg) { const e = fnCache.get(layer.id); if (e) e.error = msg; }

// fonts and symbols mentioned in an effect (so export can preload them)
export function effectFonts(layer) { return [...new Set([...(layer.code || '').matchAll(/font\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]))]; }
export function effectSymbols(layer) {
  return [...(layer.code || '').matchAll(/(?:symbol|drawSymbol)\(\s*['"]([^'"]+)['"](?:[^)]*?['"](gold|white|black)['"])?/g)].map(m => symbolPath(m[1], m[2] || 'gold')).filter(Boolean);
}
