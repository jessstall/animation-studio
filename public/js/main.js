import { newProject, newTextLayer, newImageLayer, newLightLayer, SIZES, FONTS, totalDuration, uid, defaultLights } from './model.js';
import { PRESETS, PRESET, MIDS, MID, EASE_NAMES } from './anims.js';
import { renderFrame, layerBounds, setAssetListener, phaseSpan, getImage, bumpFonts } from './render.js';
import { requestFont, ensureFonts, loadUserFonts, addFontFile, userFamilies } from './fonts.js';
import { renderEditor, parseEditor, getSelectionOffsets, setSelectionOffsets, applyStyle, styleAt } from './editor.js';
import { exportProject, zipResults, segmentFrames, slug } from './export.js';
import * as store from './storage.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let P = null;              // project
let selId = null;
let T = 0, playing = false, range = 'full', loop = true, once = false;
let pScale = 0.5;          // preview pixels per project pixel
let guides = [];
let lastRange = null;      // last text selection in the editor
const view = $('#view'), vctx = view.getContext('2d');
const overlay = $('#overlay'), octx = overlay.getContext('2d');

const sel = () => P.layers.find(l => l.id === selId);
const toast = (msg, ms = 3200) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, ms); };

// ---------------- history & saving ----------------
const undoStack = [], redoStack = [];
let lastSnap = null, snapTimer = null, saveTimer = null;
function snapshot() { return JSON.stringify(P); }
function commit({ redrawUI = true } = {}) {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const s = snapshot();
    if (s !== lastSnap) { if (lastSnap) undoStack.push(lastSnap); if (undoStack.length > 120) undoStack.shift(); redoStack.length = 0; lastSnap = s; }
  }, 350);
  clearTimeout(saveTimer); saveTimer = setTimeout(autosave, 1200);
  if (redrawUI) { renderLayerList(); renderTimeline(); }
  draw();
}
function restore(s) { P = JSON.parse(s); lastSnap = s; if (!sel()) selId = P.layers[P.layers.length - 1]?.id || null; refreshAll(); clearTimeout(saveTimer); saveTimer = setTimeout(autosave, 800); }
function undo() { clearTimeout(snapTimer); const cur = snapshot(); if (cur !== lastSnap && lastSnap) { undoStack.push(lastSnap); lastSnap = cur; } if (!undoStack.length) return; redoStack.push(lastSnap); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(lastSnap); restore(redoStack.pop()); }

async function thumbnail() {
  const c = document.createElement('canvas'); const s = 140 / P.height;
  c.width = Math.round(P.width * s); c.height = 140;
  try { renderFrame(c.getContext('2d'), P, P.sections.intro + 0.01, { scale: s }); } catch {}
  return c.toDataURL('image/png');
}
async function autosave() {
  try { await store.put('projects', { id: P.id, name: P.name, updated: Date.now(), data: snapshot(), thumb: await thumbnail() }); localStorage.setItem('as-last', P.id); } catch (e) { console.warn(e); }
}

// ---------------- canvas sizing ----------------
function fit() {
  if (!P) return;
  const st = $('#stage');
  const aw = st.clientWidth - 32, ah = st.clientHeight - 32;
  const s = Math.min(aw / P.width, ah / P.height);
  const dw = Math.max(50, Math.floor(P.width * s)), dh = Math.max(50, Math.floor(P.height * s));
  const wrap = $('#canvasWrap'); wrap.style.width = dw + 'px'; wrap.style.height = dh + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  pScale = Math.min(1, s * dpr);
  for (const c of [view, overlay]) { c.width = Math.round(P.width * pScale); c.height = Math.round(P.height * pScale); }
  draw();
}

function draw() {
  renderFrame(vctx, P, T, { scale: pScale, background: true });
  drawOverlay();
  $('#timeLbl').textContent = T.toFixed(2) + ' s';
  const tot = totalDuration(P);
  $('#tlPlayhead').style.left = `calc(${(T / tot) * 100}% - 1px)`;
}

function drawOverlay() {
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (playing) return;
  const L = sel();
  octx.setTransform(pScale, 0, 0, pScale, 0, 0);
  const lw = 1 / pScale;
  if (L) {
    const b = layerBounds(L);
    octx.save(); octx.translate(b.cx, b.cy); octx.rotate((L.rotation || 0) * Math.PI / 180);
    octx.strokeStyle = 'rgba(226,194,122,.85)'; octx.lineWidth = lw * 1.2; octx.setLineDash([5 * lw, 4 * lw]);
    octx.strokeRect(-b.w / 2 - 6, -b.h / 2 - 6, b.w + 12, b.h + 12);
    octx.restore();
  }
  octx.setLineDash([]);
  octx.strokeStyle = 'rgba(255,92,170,.9)'; octx.lineWidth = lw;
  for (const g of guides) {
    octx.beginPath();
    if (g.x !== undefined) { octx.moveTo(g.x, 0); octx.lineTo(g.x, P.height); } else { octx.moveTo(0, g.y); octx.lineTo(P.width, g.y); }
    octx.stroke();
  }
}

// ---------------- playback ----------------
function rangeBounds() {
  const { intro, mid } = P.sections, tot = totalDuration(P);
  return { full: [0, tot], intro: [0, intro], mid: [intro, intro + mid], outro: [intro + mid, tot] }[range];
}
let lastTs = 0;
function tick(ts) {
  if (!playing) return;
  const dt = lastTs ? (ts - lastTs) / 1000 : 0; lastTs = ts;
  const [a, b] = rangeBounds();
  T += dt;
  if (T >= b) {
    if (once) { once = false; T = Math.min(b, totalDuration(P) - 0.0001); range = 'full'; syncRangeButtons(); setPlaying(false); return; }
    if (loop) T = a + ((T - a) % Math.max(0.001, b - a)); else { T = b; setPlaying(false); }
  }
  draw();
  requestAnimationFrame(tick);
}
function setPlaying(on) {
  playing = on; $('#playBtn').textContent = on ? '❚❚' : '▶';
  if (on) { const [a, b] = rangeBounds(); if (T < a || T >= b - 0.01) T = a; lastTs = 0; requestAnimationFrame(tick); }
  draw();
}
const playFromStart = () => { once = false; const [a] = rangeBounds(); T = a; setPlaying(true); };
// play one section once, then go back to Full
const previewOnce = (r) => { range = r; syncRangeButtons(); const [a] = rangeBounds(); T = a; once = true; setPlaying(true); };

// ---------------- layers panel ----------------
function renderLayerList() {
  const ul = $('#layerList');
  ul.innerHTML = [...P.layers].reverse().map(l => {
    const icon = l.type === 'text' ? 'Aa' : l.type === 'light' ? '✺' : `<img src="${esc(l.src)}" style="${l.tint ? '' : ''}">`;
    return `<li data-id="${l.id}" class="${l.id === selId ? 'sel' : ''} ${l.visible === false ? 'hidden' : ''}">
      <span class="ty">${icon}</span><span class="nm">${esc(l.name)}</span>
      <button data-act="vis" title="Show / hide">${l.visible === false ? '◌' : '●'}</button>
      <button data-act="up" title="Bring forward">↑</button><button data-act="down" title="Send back">↓</button>
      <button data-act="dup" title="Duplicate">⧉</button><button data-act="del" title="Delete">✕</button></li>`;
  }).join('') || '<li class="muted" style="cursor:default">No layers yet</li>';
}
$('#layerList').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  const id = li.dataset.id, i = P.layers.findIndex(l => l.id === id), L = P.layers[i];
  const act = e.target.dataset.act;
  if (act === 'vis') L.visible = L.visible === false;
  else if (act === 'up' && i < P.layers.length - 1) [P.layers[i], P.layers[i + 1]] = [P.layers[i + 1], P.layers[i]];
  else if (act === 'down' && i > 0) [P.layers[i], P.layers[i - 1]] = [P.layers[i - 1], P.layers[i]];
  else if (act === 'dup') return duplicate(L);
  else if (act === 'del') return deleteLayer(id);
  else { select(id); return; }
  commit();
});
$('#layerList').addEventListener('dblclick', e => {
  const li = e.target.closest('li[data-id]'); if (!li || e.target.closest('button')) return;
  const L = P.layers.find(l => l.id === li.dataset.id);
  const n = prompt('Layer name', L.name); if (n) { L.name = n; commit(); }
});
function select(id) { selId = id; renderLayerList(); renderInspector(); renderTimeline(); drawOverlay(); }
function addLayer(L) { P.layers.push(L); selId = L.id; commit(); renderInspector(); }
function duplicate(L) { const c = JSON.parse(JSON.stringify(L)); c.id = uid(); c.name = L.name + ' copy'; c.y += 40; const i = P.layers.indexOf(L); P.layers.splice(i + 1, 0, c); selId = c.id; commit(); renderInspector(); }
function deleteLayer(id) { P.layers = P.layers.filter(l => l.id !== id); if (selId === id) selId = P.layers[P.layers.length - 1]?.id || null; commit(); renderInspector(); }

$('#addText').onclick = () => {
  const L = newTextLayer(P, 'Your words here');
  const prev = [...P.layers].reverse().find(l => l.type === 'text');
  if (prev) { const r = prev.lines[0].runs[0]; L.lines[0].runs[0] = { ...r, text: 'Your words here', size: Math.round(r.size * 0.6) }; L.y = Math.min(P.height - 100, prev.y + layerBounds(prev).h / 2 + 90); }
  addLayer(L);
};
$('#addLight').onclick = () => { const L = newLightLayer(P); P.layers.unshift(L); selId = L.id; commit(); renderInspector(); toast('Light added behind everything. Move it up the list to bring it forward.'); };
$('#addImage').onclick = () => $('#fileImage').click();
$('#fileImage').onchange = async e => { for (const f of e.target.files) await addImageFile(f); e.target.value = ''; };

function readDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
function imageSize(src) { return new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth || 512, i.naturalHeight || 512]); i.onerror = () => res([512, 512]); i.src = src; }); }
async function addImageFrom(src, name, tint = '') {
  const [w, h] = await imageSize(src);
  const L = newImageLayer(P, src, w, h, name);
  L.width = Math.min(Math.round(P.width * 0.38), w > 50 ? Math.max(w, 300) : 400);
  L.tint = tint;
  addLayer(L);
}
async function addImageFile(f) { await addImageFrom(await readDataURL(f), f.name.replace(/\.[^.]+$/, '')); }

// ---------------- symbols ----------------
let symbols = [];
async function loadSymbols() {
  try { symbols = await (await fetch('symbols/manifest.json')).json(); } catch { symbols = []; }
  $('#symGrid').innerHTML = symbols.map((s, i) => `<div class="sym" data-i="${i}" title="${esc(s.name)}"><img src="symbols/${esc(s.file)}" alt="" style="${s.file.endsWith('.svg') ? 'filter:invert(70%) sepia(40%) saturate(600%) hue-rotate(5deg)' : ''}"></div>`).join('');
  renderUserSymbols();
}
$('#symGrid').addEventListener('click', e => {
  const d = e.target.closest('.sym'); if (!d) return;
  const s = symbols[+d.dataset.i];
  addImageFrom('symbols/' + s.file, s.name, s.file.endsWith('.svg') ? '#C9A24F' : '');
});
async function renderUserSymbols() {
  const list = await store.all('symbols').catch(() => []);
  $('#userSymGrid').innerHTML = list.map(s => `<div class="sym" data-id="${s.id}" title="${esc(s.name)}"><img src="${s.src}" alt=""><button class="x" data-del="${s.id}">✕</button></div>`).join('') || '<p class="hint" style="grid-column:1/-1;margin:0">None yet.</p>';
}
$('#userSymGrid').addEventListener('click', async e => {
  if (e.target.dataset.del) { await store.del('symbols', e.target.dataset.del); return renderUserSymbols(); }
  const d = e.target.closest('.sym'); if (!d) return;
  const s = await store.get('symbols', d.dataset.id); addImageFrom(s.src, s.name);
});
$('#addSymbol').onclick = () => $('#fileSymbol').click();
$('#fileSymbol').onchange = async e => {
  for (const f of e.target.files) await store.put('symbols', { id: uid(), name: f.name.replace(/\.[^.]+$/, ''), src: await readDataURL(f) });
  e.target.value = ''; renderUserSymbols(); toast('Added to your symbols');
};
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#tab-layers').hidden = b.dataset.tab !== 'layers'; $('#tab-symbols').hidden = b.dataset.tab !== 'symbols';
});

// drag & drop images onto the stage
const stage = $('#stage');
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('dropping'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
stage.addEventListener('drop', async e => {
  e.preventDefault(); stage.classList.remove('dropping');
  for (const f of e.dataTransfer.files) {
    if (f.type.startsWith('image/')) await addImageFile(f);
    else if (/\.(ttf|otf|woff2?)$/i.test(f.name)) { await addFontFile(f); toast('Font added: ' + f.name); renderInspector(); }
  }
});

// ---------------- canvas interaction ----------------
function toProject(e) { const r = overlay.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * P.width, (e.clientY - r.top) / r.height * P.height]; }
function hitTest(x, y) {
  for (let i = P.layers.length - 1; i >= 0; i--) {
    const L = P.layers[i]; if (L.visible === false) continue;
    const b = layerBounds(L);
    const a = -(L.rotation || 0) * Math.PI / 180, dx = x - b.cx, dy = y - b.cy;
    const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
    const pad = 12;
    if (Math.abs(rx) <= b.w / 2 + pad && Math.abs(ry) <= b.h / 2 + pad) return L;
  }
  return null;
}
let drag = null;
overlay.addEventListener('pointerdown', e => {
  if (playing) setPlaying(false);
  const [x, y] = toProject(e);
  const L = hitTest(x, y);
  if (!L) { if (selId) { selId = null; renderLayerList(); renderInspector(); renderTimeline(); drawOverlay(); } return; }
  if (L.id !== selId) select(L.id);
  drag = { L, ox: x - L.x, oy: y - L.y, moved: false };
  overlay.setPointerCapture(e.pointerId);
});
overlay.addEventListener('pointermove', e => {
  const [x, y] = toProject(e);
  overlay.style.cursor = drag ? 'grabbing' : hitTest(x, y) ? 'grab' : 'default';
  if (!drag) return;
  const L = drag.L;
  let nx = x - drag.ox, ny = y - drag.oy;
  // snapping
  const th = 7 / (overlay.getBoundingClientRect().width / P.width);
  const b = layerBounds(L);
  const xs = [P.width / 2], ys = [P.height / 2];
  for (const o of P.layers) if (o !== L && o.visible !== false) { const ob = layerBounds(o); xs.push(ob.cx, ob.x, ob.x + ob.w); ys.push(ob.cy, ob.y, ob.y + ob.h); }
  guides = [];
  const snap1 = (val, half, cands, axis) => {
    let best = null;
    for (const c of cands) for (const off of [0, -half, half]) { const d = c - (val + off); if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, c }; }
    if (best) { guides.push(axis === 'x' ? { x: best.c } : { y: best.c }); return val + best.d; }
    return val;
  };
  if (!e.altKey) { nx = snap1(nx, b.w / 2, xs, 'x'); ny = snap1(ny, b.h / 2, ys, 'y'); }
  L.x = Math.round(nx * 10) / 10; L.y = Math.round(ny * 10) / 10; drag.moved = true;
  draw(); syncPosInputs();
});
overlay.addEventListener('pointerup', () => { if (drag?.moved) commit({ redrawUI: false }); drag = null; guides = []; drawOverlay(); });
overlay.addEventListener('dblclick', () => { const ed = $('#editor'); if (ed) { ed.focus(); document.execCommand('selectAll'); } });
function syncPosInputs() { const L = sel(); if (!L) return; const x = $('[data-k="x"]'), y = $('[data-k="y"]'); if (x) x.value = Math.round(L.x); if (y) y.value = Math.round(L.y); }

// ---------------- timeline ----------------
function renderTimeline() {
  const { intro, mid, outro } = P.sections, tot = totalDuration(P);
  $('#durIntro').value = intro; $('#durMid').value = mid; $('#durOutro').value = outro;
  $('#durTotal').textContent = `Total ${tot.toFixed(2)} s · ${segmentFrames(P).N} frames`;
  const pc = v => (v / tot * 100) + '%';
  $('#tlSections').innerHTML = `<div style="width:${pc(intro)};background:var(--intro)">Intro<span class="grip" data-g="intro"></span></div><div style="width:${pc(mid)};background:var(--mid)">Mid<span class="grip" data-g="mid"></span></div><div style="width:${pc(outro)};background:var(--outro)">Outro</div>`;
  $('#tlRows').innerHTML = [...P.layers].reverse().map(L => {
    const a = phaseSpan(L, 'in', P), b = phaseSpan(L, 'out', P);
    const inEnd = a ? a.end : 0, outStart = b ? b.start : tot;
    let bars = '';
    if (a) bars += `<div class="bar in" style="left:${pc(Math.max(0, a.start))};width:${pc(Math.max(0.02, a.end - a.start))}"></div>`;
    bars += `<div class="bar hold" style="left:${pc(inEnd)};width:${pc(Math.max(0, outStart - inEnd))}"></div>`;
    if (b) bars += `<div class="bar out" style="left:${pc(b.start)};width:${pc(Math.max(0.02, Math.min(tot, b.end) - b.start))}"></div>`;
    return `<div class="tl-row ${L.id === selId ? 'sel' : ''}" data-id="${L.id}">${bars}<span class="lbl">${esc(L.name)}</span></div>`;
  }).join('');
  draw();
}
for (const [id, k] of [['#durIntro', 'intro'], ['#durMid', 'mid'], ['#durOutro', 'outro']]) {
  $(id).addEventListener('change', e => { P.sections[k] = Math.max(0, Math.round(+e.target.value * 100) / 100 || 0); T = Math.min(T, totalDuration(P)); commit(); renderInspector(); });
}
let tlDrag = null;
$('#tlBody').addEventListener('pointerdown', e => {
  const r = $('#tlBody').getBoundingClientRect();
  if (e.target.classList.contains('grip')) { tlDrag = { grip: e.target.dataset.g, r }; }
  else {
    const row = e.target.closest('.tl-row'); if (row && row.dataset.id !== selId) select(row.dataset.id);
    tlDrag = { scrub: true, r }; if (playing) setPlaying(false);
    T = Math.max(0, Math.min(totalDuration(P), (e.clientX - r.left) / r.width * totalDuration(P))); draw();
  }
  $('#tlBody').setPointerCapture(e.pointerId);
});
$('#tlBody').addEventListener('pointermove', e => {
  if (!tlDrag) return;
  const tot = totalDuration(P), r = tlDrag.r;
  const at = Math.max(0, Math.min(tot, (e.clientX - r.left) / r.width * tot));
  if (tlDrag.scrub) { T = at; draw(); return; }
  const snapT = v => Math.round(v * 10) / 10;
  if (tlDrag.grip === 'intro') { const end = P.sections.intro + P.sections.mid; P.sections.intro = snapT(Math.min(at, end - 0.1)); P.sections.mid = Math.round((end - P.sections.intro) * 100) / 100; }
  else { P.sections.mid = snapT(Math.max(0.1, at - P.sections.intro)); }
  tlDrag.changed = true; renderTimeline();
});
$('#tlBody').addEventListener('pointerup', () => { if (tlDrag?.changed) { commit(); renderInspector(); } tlDrag = null; });

// ---------------- inspector ----------------
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const openSecs = new Set(JSON.parse(localStorage.getItem('as-open') || '["text","layout","animate","image","light"]'));

function slider(label, k, min, max, step, unit = '') {
  const v = getPath(sel(), k);
  return `<div class="row"><label>${label}</label><input type="range" class="grow" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="val" data-v="${k}">${fmt(v)}${unit}</span></div>`;
}
const fmt = v => typeof v === 'number' ? (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : v.toFixed(2).replace(/0$/, '')) : v;
function num(label, k, step = 1, extra = '') { return `<div class="row"><label>${label}</label><input type="number" data-k="${k}" step="${step}" value="${getPath(sel(), k)}" ${extra}></div>`; }
function color(label, k) { return `<div class="row"><label>${label}</label><input type="color" data-k="${k}" value="${getPath(sel(), k) || '#ffffff'}"><span class="muted small">${getPath(sel(), k) || ''}</span></div>`; }
function check(label, k) { return `<label class="chk"><input type="checkbox" data-k="${k}" ${getPath(sel(), k) ? 'checked' : ''}> ${label}</label>`; }
function sec(id, title, body) { return `<details class="sec" data-sec="${id}" ${openSecs.has(id) ? 'open' : ''}><summary>${title}</summary><div class="body">${body}</div></details>`; }

const SWATCHES = ['#FFFFFF', '#F6EFE3', '#E8D3A3', '#C9A24F', '#B8862F', '#1B1B1B'];
const WEIGHTS = [[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];

function fontOptions(cur) {
  const groups = {};
  const uf = userFamilies();
  if (uf.length) groups['Your fonts'] = uf;
  for (const f of FONTS) (groups[f.group] ||= []).push(f.name);
  let h = Object.entries(groups).map(([g, list]) => `<optgroup label="${g}">${list.map(n => `<option ${n === cur ? 'selected' : ''} style="font-family:'${n}'">${esc(n)}</option>`).join('')}</optgroup>`).join('');
  if (!Object.values(groups).flat().includes(cur)) h = `<option selected>${esc(cur)}</option>` + h;
  return h + `<option value="__upload">Upload a font file…</option>`;
}

function textSection(L) {
  const r = styleAt(L, lastRange);
  return `<div class="toolbar">
      <select class="font" id="tbFont" title="Font">${fontOptions(r.font)}</select>
      <select id="tbWeight" title="Weight">${WEIGHTS.map(([w, n]) => `<option value="${w}" ${+r.weight === w ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="tb ${r.weight >= 600 ? 'on' : ''}" id="tbBold" title="Bold (Ctrl/Cmd+B)"><b>B</b></button>
      <button class="tb ${r.italic ? 'on' : ''}" id="tbItalic" title="Italic (Ctrl/Cmd+I)"><i style="font-family:Georgia">I</i></button>
      <input type="number" id="tbSize" min="6" max="800" value="${r.size}" title="Size (px)">
      <input type="color" id="tbColor" value="${r.color}" title="Colour">
      ${SWATCHES.map(c => `<button class="tb sw" data-sw="${c}" title="${c}" style="background:${c};min-width:20px;height:20px;padding:0;border-radius:50%"></button>`).join('')}
    </div>
    <div id="editor" class="editor" contenteditable="true" spellcheck="false"></div>
    <p class="note">Select some words to style just those (font, bold, italic, size, colour). With nothing selected, changes apply to the whole text.</p>`;
}

function linesSection(L) {
  return `<div class="row"><span class="lab">Align</span><div class="seg small" id="alignSeg">${['left', 'center', 'right'].map(a => `<button data-al="${a}" class="${L.align === a ? 'on' : ''}">${a === 'center' ? 'Centre' : a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div></div>
    ${slider('Line spacing', 'lineHeight', 0.6, 2.5, 0.01)}
    ${slider('Letter spacing', 'tracking', -100, 400, 1)}
    <div class="subhead">Each line</div>
    <div class="lines" id="linesBox">${L.lines.map((ln, i) => `<div class="lineitem">
      <div class="ln">${i + 1}. ${esc(ln.runs.map(r => r.text).join('')) || '<span class="muted">(empty line)</span>'}</div>
      <label title="Extra space above this line">Space above <input type="number" data-line="${i}" data-lk="gap" value="${ln.gap || 0}" step="2"></label>
      <label title="Nudge this line sideways">Nudge <input type="number" data-line="${i}" data-lk="dx" value="${ln.dx || 0}" step="2"></label>
      <label title="Extra delay before this line animates in">In delay s <input type="number" data-line="${i}" data-lk="delayIn" value="${ln.delayIn || 0}" step="0.05" min="0"></label>
      <label title="Extra delay before this line animates out">Out delay s <input type="number" data-line="${i}" data-lk="delayOut" value="${ln.delayOut || 0}" step="0.05" min="0"></label>
    </div>`).join('')}</div>`;
}

function phaseBody(L, phase) {
  const a = L.anim[phase], isOut = phase === 'out';
  const groups = {};
  for (const p of PRESETS) (groups[p.group] ||= []).push(p);
  const chips = Object.entries(groups).map(([g, list]) => `<div class="pgroup">${g}</div>` + list.map(p => `<button data-preset="${phase}:${p.id}" class="${a.preset === p.id ? 'on' : ''}">${isOut ? p.outName : p.name}</button>`).join('')).join('');
  const P0 = PRESET[a.preset] || PRESET.none;
  const special = P0.kind === 'particles' || P0.kind === 'birds';
  let warn = '';
  const span = phaseSpan(L, phase, P);
  if (span) {
    if (!isOut && span.end > P.sections.intro + 0.001) warn = `<p class="warn">This finishes at ${span.end.toFixed(2)} s, after the intro ends (${P.sections.intro} s). Shorten it or lengthen the intro.</p>`;
    if (isOut && span.end > totalDuration(P) + 0.001) warn = `<p class="warn">This runs ${(span.end - totalDuration(P)).toFixed(2)} s past the end. Shorten it or lengthen the outro.</p>`;
  }
  return `<div class="presets">${chips}</div>
    ${a.preset === 'none' ? '' : `
    ${L.type === 'text' && !special ? `<div class="row"><span class="lab">Moves by</span><div class="seg small" data-by="${phase}">${[['all', 'Whole'], ['line', 'Line'], ['word', 'Word'], ['letter', 'Letter']].map(([v, n]) => `<button data-v="${v}" class="${a.by === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div class="row"><label>Order</label><select data-k="anim.${phase}.dir" class="grow">${[['forward', 'First to last'], ['reverse', 'Last to first'], ['center', 'From the centre out'], ['edges', 'From the edges in'], ['random', 'Random']].map(([v, n]) => `<option value="${v}" ${a.dir === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}
    ${num(isOut ? 'Starts (s into outro)' : 'Starts at (s)', `anim.${phase}.start`, 0.05, 'min="0"')}${num(L.type === 'text' && !special && a.by !== 'all' ? 'Each takes (s)' : 'Takes (s)', `anim.${phase}.duration`, 0.05, 'min="0.05"')}
    ${L.type === 'text' && !special && a.by !== 'all' ? num('Gap between (s)', `anim.${phase}.stagger`, 0.01, 'min="0"') : ''}
    <div class="row"><label>Feel</label><select data-k="anim.${phase}.ease" class="grow"><option value="">Preset default</option>${Object.entries(EASE_NAMES).map(([k, n]) => `<option value="${k}" ${a.ease === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    ${a.preset === 'custom' ? customBody(L, phase) : ''}
    `}${warn}
    <button class="ghost" data-preview="${phase}">▶ Preview ${isOut ? 'outro' : 'intro'}</button>`;
}
function customBody(L, phase) {
  const key = phase === 'in' ? 'from' : 'to';
  const a = L.anim[phase]; a[key] ||= { o: 0 };
  const f = a[key];
  const fields = [['o', 'Opacity', 0, 1, 0.01], ['x', 'Move x', -800, 800, 1], ['y', 'Move y', -800, 800, 1], ['s', 'Scale', 0, 4, 0.01], ['r', 'Rotate°', -360, 360, 1], ['b', 'Blur', 0, 60, 0.5], ['sk', 'Skew°', -60, 60, 1], ['spread', 'Spread', -1, 2, 0.01]];
  return `<div class="subhead">${phase === 'in' ? 'Starts from' : 'Ends at'}</div>` + fields.map(([k, n, mi, ma, st]) => `<div class="row"><label>${n}</label><input type="range" class="grow" data-custom="${phase}.${key}.${k}" min="${mi}" max="${ma}" step="${st}" value="${f[k] ?? ({ o: 1, s: 1 }[k] ?? 0)}"><span class="val">${fmt(f[k] ?? ({ o: 1, s: 1 }[k] ?? 0))}</span></div>`).join('');
}
function midBody(L) {
  const m = L.anim.mid;
  const def = MID[m.preset] || MID.none;
  return `<div class="presets">${MIDS.map(x => `<button data-mid="${x.id}" class="${m.preset === x.id ? 'on' : ''}">${x.name}</button>`).join('')}</div>
    ${m.preset === 'none' ? '<p class="note">Still is the safest choice if the mid section will be trimmed in the edit: any cut joins the outro seamlessly.</p>' : `
    ${slider('Strength', 'anim.mid.amount', 0.1, 3, 0.05)}
    <div class="row"><label>Cycle s</label><input type="number" data-k="anim.mid.period" step="0.1" min="0" value="${m.period || def.period}"><span class="note">${m.preset === 'rotate' ? 'seconds per full turn' : 'seconds per cycle'}</span></div>
    ${['pulse', 'glow', 'shimmer'].includes(m.preset) ? color('Glow colour', 'anim.mid.color') : ''}
    <p class="note">Tip: a mid section that is a whole number of cycles loops cleanly.</p>`}`;
}
function lightBody(L) {
  const o = L.lights.orb, r = L.lights.rays;
  return `${check('Orb of light', 'lights.orb.on')}
    ${o.on ? `${color('Colour', 'lights.orb.color')}${slider('Intensity', 'lights.orb.intensity', 0, 1.5, 0.01)}${slider('Size', 'lights.orb.size', 20, 1400, 1)}${slider('Bright core', 'lights.orb.core', 0, 1, 0.01)}
    <div class="pair">${num('X', 'lights.orb.x')}${num('Y', 'lights.orb.y')}</div>` : ''}
    <div class="subhead"></div>
    ${check('Rays', 'lights.rays.on')}
    ${r.on ? `${color('Colour', 'lights.rays.color')}${slider('Intensity', 'lights.rays.intensity', 0, 1.5, 0.01)}
    ${slider('Number', 'lights.rays.count', 1, 64, 1)}
    <div class="row"><label>Spread</label><div class="seg small" id="spreadSeg">${[[360, 'Full burst'], [180, '180°'], [120, '120°'], [90, '90°'], [45, '45°']].map(([v, n]) => `<button data-sp="${v}" class="${+r.spread === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    ${slider('Spread °', 'lights.rays.spread', 5, 360, 1)}
    ${slider('Direction °', 'lights.rays.direction', -180, 180, 1)}
    ${slider('Length', 'lights.rays.length', 40, 2000, 1)}
    ${slider('Ray width', 'lights.rays.width', 0.03, 1, 0.01)}
    ${slider('Start gap', 'lights.rays.inner', 0, 600, 1)}
    ${slider('Softness', 'lights.rays.softness', 0, 40, 0.5)}
    ${slider('Turning °/s', 'lights.rays.turn', -60, 60, 0.5)}
    <div class="pair">${num('X', 'lights.rays.x')}${num('Y', 'lights.rays.y')}</div>` : ''}
    <p class="note">${L.type === 'light' ? 'This light fades and grows with its own intro and outro.' : 'Lights sit behind this layer and come and go with it.'}</p>`;
}

function renderInspector() {
  const box = $('#inspector'); const scroll = box.scrollTop;
  const L = sel();
  if (!L) { box.innerHTML = `<div class="insp-empty"><p>Select a layer to edit it,<br>or add text, an image or a symbol.</p></div>`; return; }
  L.lights ||= defaultLights();
  let h = `<div class="sec" style="padding:12px 14px"><input id="layerName" value="${esc(L.name)}" style="width:100%;font-weight:600" title="Layer name"></div>`;
  if (L.type === 'text') h += sec('text', 'Text', textSection(L)) + sec('lines', 'Lines & spacing', linesSection(L));
  if (L.type === 'image') h += sec('image', 'Image', `
      ${slider('Width', 'width', 20, Math.max(P.width, P.height), 1)}
      <div class="row"><label>Colour</label><label class="chk"><input type="checkbox" id="tintOn" ${L.tint ? 'checked' : ''}> Recolour</label>${L.tint ? `<input type="color" data-k="tint" value="${L.tint}">` : ''}</div>
      ${L.tint ? `<div class="toolbar">${SWATCHES.map(c => `<button class="tb sw" data-tint="${c}" style="background:${c};min-width:20px;height:20px;padding:0;border-radius:50%"></button>`).join('')}</div>` : ''}
      <button class="ghost" id="replaceImg">Replace image…</button>`);
  h += sec('layout', 'Position & size', `
      <div class="pair">${num('X', 'x')}${num('Y', 'y')}</div>
      <div class="row"><span class="lab">Centre</span><button class="ghost" id="cH">Horizontally</button><button class="ghost" id="cV">Vertically</button></div>
      ${slider('Scale', 'scale', 0.1, 4, 0.01)}${slider('Rotation °', 'rotation', -180, 180, 0.5)}${slider('Opacity', 'opacity', 0, 1, 0.01)}`);
  if (L.type !== 'light') h += sec('shadow', 'Drop shadow', `${check('Shadow', 'shadow.on')}
      ${L.shadow.on ? `${color('Colour', 'shadow.color')}${slider('Strength', 'shadow.opacity', 0, 1, 0.01)}${slider('Softness', 'shadow.blur', 0, 120, 1)}
      <div class="pair">${num('X', 'shadow.x')}${num('Y', 'shadow.y')}</div>
      <button class="ghost" id="shadowDefault">Reset to soft centred</button>` : ''}`);
  h += sec('light', L.type === 'light' ? 'Light' : 'Light behind (orb & rays)', lightBody(L));
  h += sec('animate', 'Animation', `<div class="subhead">Intro — coming in</div>${phaseBody(L, 'in')}
      <div class="subhead">Mid section — the hold</div>${midBody(L)}
      <div class="subhead">Outro — going out</div>${phaseBody(L, 'out')}`);
  box.innerHTML = h;
  box.scrollTop = scroll;
  if (L.type === 'text') { const ed = $('#editor'); renderEditor(ed, L); bindEditor(ed, L); }
  bindInspector(L);
}

function bindInspector(L) {
  const box = $('#inspector');
  box.querySelectorAll('details.sec').forEach(d => d.addEventListener('toggle', () => { d.open ? openSecs.add(d.dataset.sec) : openSecs.delete(d.dataset.sec); localStorage.setItem('as-open', JSON.stringify([...openSecs])); }));
  $('#layerName').oninput = e => { L.name = e.target.value; commit(); };
  box.querySelectorAll('[data-k]').forEach(inp => {
    const k = inp.dataset.k;
    const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' || inp.type === 'number' ? parseFloat(inp.value) : inp.value;
      if (typeof v === 'number' && isNaN(v)) return;
      setPath(L, k, v);
      const lab = box.querySelector(`[data-v="${k}"]`); if (lab) lab.textContent = fmt(v);
      if (inp.type === 'color' && inp.nextElementSibling?.classList.contains('small')) inp.nextElementSibling.textContent = v;
      commit({ redrawUI: k.startsWith('anim') });
      if (inp.type === 'checkbox' || inp.tagName === 'SELECT' || (inp.type === 'number' && k.startsWith('anim'))) renderInspector();
    });
  });
  box.querySelectorAll('[data-custom]').forEach(inp => inp.addEventListener('input', () => {
    const [phase, key, k] = inp.dataset.custom.split('.');
    L.anim[phase][key][k] = parseFloat(inp.value); inp.nextElementSibling.textContent = fmt(parseFloat(inp.value)); commit();
  }));
  box.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const [phase, id] = b.dataset.preset.split(':');
    const p = PRESET[id], a = L.anim[phase];
    a.preset = id; a.ease = '';
    if (p.by) a.by = L.type === 'text' ? p.by : 'all';
    if (p.duration) a.duration = p.duration;
    if (p.stagger !== undefined) a.stagger = p.stagger;
    if (id === 'birds' && phase === 'out' && P.sections.outro < 2.6) P.sections.outro = 3;
    if (id === 'particles' && phase === 'out' && P.sections.outro < 1.9) P.sections.outro = 2.2;
    commit(); renderInspector();
    previewOnce(phase === 'in' ? 'intro' : 'outro');
  });
  box.querySelectorAll('[data-by]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.onclick = () => {
    const a = L.anim[seg.dataset.by]; a.by = b.dataset.v;
    if (a.by === 'all') a.stagger = 0; else if (!a.stagger) a.stagger = a.by === 'letter' ? 0.035 : 0.09;
    commit(); renderInspector();
  }));
  box.querySelectorAll('[data-mid]').forEach(b => b.onclick = () => {
    const m = L.anim.mid; m.preset = b.dataset.mid; m.period = 0; m.amount = 1; m.color = MID[m.preset]?.color || m.color;
    commit(); renderInspector(); previewOnce('mid');
  });
  box.querySelectorAll('[data-preview]').forEach(b => b.onclick = () => previewOnce(b.dataset.preview === 'in' ? 'intro' : 'outro'));
  box.querySelectorAll('#alignSeg button').forEach(b => b.onclick = () => { L.align = b.dataset.al; commit(); renderInspector(); });
  box.querySelectorAll('#spreadSeg button').forEach(b => b.onclick = () => { L.lights.rays.spread = +b.dataset.sp; commit(); renderInspector(); });
  box.querySelectorAll('[data-line]').forEach(inp => inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (isNaN(v)) return; L.lines[+inp.dataset.line][inp.dataset.lk] = v; commit(); }));
  const cH = $('#cH'), cV = $('#cV');
  if (cH) cH.onclick = () => { L.x = P.width / 2; commit(); renderInspector(); };
  if (cV) cV.onclick = () => { L.y = P.height / 2; commit(); renderInspector(); };
  const sd = $('#shadowDefault'); if (sd) sd.onclick = () => { Object.assign(L.shadow, { on: true, color: '#000000', opacity: 0.4, blur: 30, x: 0, y: 0 }); commit(); renderInspector(); };
  const tOn = $('#tintOn'); if (tOn) tOn.onchange = () => { L.tint = tOn.checked ? '#C9A24F' : ''; commit(); renderInspector(); };
  box.querySelectorAll('[data-tint]').forEach(b => b.onclick = () => { L.tint = b.dataset.tint; commit(); renderInspector(); });
  const rep = $('#replaceImg'); if (rep) rep.onclick = () => { const f = $('#fileImage'); f.dataset.replace = L.id; f.click(); };
}
// replace image via the same input
const origImgChange = $('#fileImage').onchange;
$('#fileImage').onchange = async e => {
  const rid = e.target.dataset.replace;
  if (rid && e.target.files[0]) {
    const L = P.layers.find(l => l.id === rid); delete e.target.dataset.replace;
    const src = await readDataURL(e.target.files[0]); const [w, h] = await imageSize(src);
    Object.assign(L, { src, natW: w, natH: h }); e.target.value = ''; commit(); renderInspector(); return;
  }
  delete e.target.dataset.replace;
  return origImgChange(e);
};

// ---------------- text editor binding ----------------
function bindEditor(ed, L) {
  lastRange = null;
  ed.addEventListener('input', () => {
    L.lines = parseEditor(ed, L);
    for (const ln of L.lines) for (const r of ln.runs) requestFont(r.font);
    commit();
    refreshLinesBox(L);
  });
  ed.addEventListener('paste', e => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
  ed.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); const r = styleAt(L, lastRange); style({ weight: r.weight >= 600 ? 400 : 700 }); }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); const r = styleAt(L, lastRange); style({ italic: !r.italic }); }
  });
  const style = (patch) => {
    const rg = lastRange && document.activeElement !== ed ? lastRange : (getSelectionOffsets(ed) || lastRange);
    const hasSel = rg && rg.start !== rg.end;
    applyStyle(L, hasSel ? rg : null, patch);
    if (patch.font) requestFont(patch.font);
    renderEditor(ed, L);
    if (hasSel) { ed.focus(); setSelectionOffsets(ed, rg); lastRange = rg; }
    commit(); updateToolbar(L); refreshLinesBox(L);
  };
  $('#tbFont').onchange = e => {
    if (e.target.value === '__upload') { $('#fileFont').click(); e.target.value = styleAt(L, lastRange).font; return; }
    style({ font: e.target.value });
  };
  $('#tbWeight').onchange = e => style({ weight: +e.target.value });
  $('#tbBold').onmousedown = e => e.preventDefault();
  $('#tbBold').onclick = () => { const r = styleAt(L, lastRange); style({ weight: r.weight >= 600 ? 400 : 700 }); };
  $('#tbItalic').onmousedown = e => e.preventDefault();
  $('#tbItalic').onclick = () => { const r = styleAt(L, lastRange); style({ italic: !r.italic }); };
  $('#tbSize').onchange = e => { const v = +e.target.value; if (v > 0) style({ size: v }); };
  $('#tbColor').oninput = e => style({ color: e.target.value.toUpperCase() });
  $$('#inspector [data-sw]').forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => style({ color: b.dataset.sw }); });
}
function updateToolbar(L) {
  const r = styleAt(L, lastRange); if (!r || !$('#tbFont')) return;
  if ($('#tbFont').value !== r.font) $('#tbFont').innerHTML = fontOptions(r.font);
  $('#tbWeight').value = r.weight; $('#tbSize').value = r.size; $('#tbColor').value = r.color;
  $('#tbBold').classList.toggle('on', r.weight >= 600); $('#tbItalic').classList.toggle('on', !!r.italic);
}
function refreshLinesBox(L) {
  const box = $('#linesBox'); if (!box) return;
  if (box.children.length !== L.lines.length) { const sec = box.closest('.body'); sec.innerHTML = linesSection(L); bindInspector(L); }
  else [...box.children].forEach((c, i) => { c.querySelector('.ln').innerHTML = `${i + 1}. ${esc(L.lines[i].runs.map(r => r.text).join('')) || '<span class="muted">(empty line)</span>'}`; });
}
$('#fileFont').onchange = async e => {
  for (const f of e.target.files) { try { const rec = await addFontFile(f); toast(`Font added: ${rec.family}`); } catch (err) { toast('That font file could not be read.'); } }
  e.target.value = ''; renderInspector(); draw();
};

// ---------------- header controls ----------------
function refreshHeader() {
  $('#projName').value = P.name;
  const key = Object.keys(SIZES).find(k => SIZES[k].w === P.width && SIZES[k].h === P.height) || 'custom';
  $('#sizeSel').innerHTML = Object.entries(SIZES).map(([k, s]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${s.name}</option>`).join('') + (key === 'custom' ? `<option selected>${P.width}×${P.height}</option>` : '');
  $('#fpsSel').value = String(P.fps);
}
$('#projName').oninput = e => { P.name = e.target.value; commit({ redrawUI: false }); };
$('#sizeSel').onchange = e => {
  const s = SIZES[e.target.value]; if (!s) return;
  const sx = s.w / P.width, sy = s.h / P.height;
  for (const L of P.layers) { L.x *= sx; L.y *= sy; }
  P.width = s.w; P.height = s.h; commit(); fit();
};
$('#fpsSel').onchange = e => { P.fps = +e.target.value; commit(); };
$('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
$('#saveBtn').onclick = async () => { await autosave(); toast('Saved in this browser. Use Open → “Download current as file” for a backup.'); };
$('#newBtn').onclick = async () => { await autosave(); P = newProject(); selId = P.layers[0].id; undoStack.length = 0; redoStack.length = 0; lastSnap = snapshot(); T = 0; refreshAll(); autosave(); };

// open dialog
$('#openBtn').onclick = async () => { await autosave(); await renderProjList(); $('#openDlg').showModal(); };
$('#openClose').onclick = () => $('#openDlg').close();
async function renderProjList() {
  const list = (await store.all('projects')).sort((a, b) => b.updated - a.updated);
  $('#projList').innerHTML = list.map(p => `<li><img src="${p.thumb || ''}" alt=""><span class="nm">${esc(p.name)}${p.id === P.id ? ' <span class="muted">(open)</span>' : ''}<small>${new Date(p.updated).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
    <button data-open="${p.id}" class="ghost">Open</button><button data-copy="${p.id}" class="ghost" title="Make a copy">Copy</button><button data-del="${p.id}" class="ghost">Delete</button></li>`).join('') || '<li class="muted">Nothing saved yet.</li>';
}
$('#projList').addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.open) { const r = await store.get('projects', t.dataset.open); loadProject(JSON.parse(r.data)); $('#openDlg').close(); }
  if (t.dataset.copy) { const r = await store.get('projects', t.dataset.copy); const d = JSON.parse(r.data); d.id = uid(); d.name += ' copy'; await store.put('projects', { id: d.id, name: d.name, updated: Date.now(), data: JSON.stringify(d), thumb: r.thumb }); renderProjList(); }
  if (t.dataset.del) { if (t.dataset.del === P.id) return toast('That one is open. Open another first.'); if (confirm('Delete this animation?')) { await store.del('projects', t.dataset.del); renderProjList(); } }
});
$('#exportProj').onclick = () => download(new Blob([JSON.stringify(P, null, 1)], { type: 'application/json' }), slug(P.name) + '.animation.json');
$('#importProj').onclick = () => $('#fileProject').click();
$('#fileProject').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d.layers) throw 0; d.id = uid(); loadProject(d); $('#openDlg').close(); toast('Imported'); } catch { toast('That file is not an animation.'); }
  e.target.value = '';
};
function loadProject(d) { P = d; selId = P.layers[P.layers.length - 1]?.id || null; undoStack.length = 0; redoStack.length = 0; lastSnap = snapshot(); T = 0; refreshAll(); localStorage.setItem('as-last', P.id); }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }

// transport
$('#playBtn').onclick = () => { once = false; setPlaying(!playing); };
function syncRangeButtons() { $$('#rangeSeg button').forEach(b => b.classList.toggle('on', b.dataset.range === range)); }
$$('#rangeSeg button').forEach(b => b.onclick = () => { range = b.dataset.range; syncRangeButtons(); playFromStart(); });
$('#loopChk').onchange = e => loop = e.target.checked;
$$('#bgSeg button').forEach(b => b.onclick = () => {
  if (b.dataset.bg === 'image') { $('#fileStill').click(); return; }
  P.background.mode = b.dataset.bg; syncBg(); commit({ redrawUI: false });
});
$('#fileStill').onchange = async e => { const f = e.target.files[0]; if (!f) return; P.background = { mode: 'image', image: await readDataURL(f) }; e.target.value = ''; syncBg(); commit({ redrawUI: false }); };
function syncBg() { $$('#bgSeg button').forEach(b => b.classList.toggle('on', b.dataset.bg === P.background.mode)); }

// ---------------- export ----------------
let exResults = [], exAbort = null;
$('#exportBtn').onclick = () => {
  setPlaying(false);
  const s = segmentFrames(P);
  $('#exInfo').textContent = `${P.width} × ${P.height}, ${P.fps} fps, ${totalDuration(P).toFixed(2)} s (${s.N} frames). Intro ${P.sections.intro} s · Mid ${P.sections.mid} s · Outro ${P.sections.outro} s. Exports are transparent; the preview background is not included.`;
  $('#exStatus').textContent = ''; $('#exResults').innerHTML = ''; $('#exProg').hidden = true; $('#exZip').hidden = true; $('#exGo').disabled = false;
  $('#exportDlg').showModal();
};
$('#exClose').onclick = () => { if (exAbort) exAbort.abort(); $('#exportDlg').close(); };
$('#exGo').onclick = async () => {
  const formats = { mov: $('#exMov').checked, webm: $('#exWebm').checked, png: $('#exPng').checked };
  const segments = { full: $('#exFull').checked, intro: $('#exIntro').checked, mid: $('#exMid').checked, outro: $('#exOutro').checked };
  if (!Object.values(formats).some(Boolean)) return toast('Choose at least one file type.');
  if (!formats.png && !Object.values(segments).some(Boolean)) return toast('Choose at least one piece.');
  $('#exGo').disabled = true; $('#exProg').hidden = false; $('#exResults').innerHTML = ''; $('#exZip').hidden = true;
  exAbort = new AbortController();
  const bar = $('#exProg i');
  try {
    exResults = await exportProject(P, { formats, segments, signal: exAbort.signal, onStatus: s => $('#exStatus').textContent = s, onProgress: p => bar.style.width = (p * 100).toFixed(1) + '%' });
    $('#exResults').innerHTML = exResults.map((r, i) => `<li><span>${esc(r.name)} <span class="muted small">${(r.blob.size / 1048576).toFixed(1)} MB</span></span><a href="#" data-dl="${i}">Download</a></li>`).join('');
    $('#exZip').hidden = exResults.length < 2;
    $('#exStatus').textContent = 'Done. Your files are ready.';
  } catch (err) {
    console.error(err); $('#exStatus').textContent = (err.message || 'Export failed') + (String(err.message).includes('fetch') ? ' — check your internet connection (the encoder downloads the first time).' : '');
  }
  exAbort = null; $('#exGo').disabled = false;
};
$('#exResults').addEventListener('click', e => { const i = e.target.dataset.dl; if (i === undefined) return; e.preventDefault(); download(exResults[+i].blob, exResults[+i].name); });
$('#exZip').onclick = async () => download(await zipResults(exResults, P), slug(P.name) + '.zip');

// ---------------- suggest ----------------
$('#suggestForm').onsubmit = async e => {
  e.preventDefault();
  const prompt = $('#suggestInput').value.trim(); if (!prompt) return;
  const target = $('#suggestTarget').value;
  if (target === 'selected' && !sel()) return toast('Select a layer first, or choose “All layers”.');
  const btn = $('#suggestBtn'); btn.disabled = true; btn.textContent = 'Thinking…';
  const summary = { sections: P.sections, layers: P.layers.map(l => ({ id: l.id, type: l.type, name: l.name, text: l.type === 'text' ? l.lines.map(x => x.runs.map(r => r.text).join('')) : undefined, anim: l.anim, lights: l.lights })) };
  try {
    const r = await fetch('api/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, target, selectedId: selId, project: summary }) });
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error('Suggest is not switched on yet. It works once the studio is published on Cloudflare with an Anthropic API key.');
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    applySuggestion(d);
    toast(d.note || 'Suggestion applied. Undo (Ctrl/Cmd+Z) to go back.', 5000);
    range = 'full'; syncRangeButtons(); playFromStart();
  } catch (err) { toast(err.message, 6000); }
  btn.disabled = false; btn.textContent = 'Suggest';
};
function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]); else if (b[k] !== undefined) a[k] = b[k]; } return a; }
function applySuggestion(d) {
  if (d.sections) for (const k of ['intro', 'mid', 'outro']) if (typeof d.sections[k] === 'number' && d.sections[k] >= 0) P.sections[k] = d.sections[k];
  for (const s of d.layers || []) {
    const L = P.layers.find(l => l.id === s.id); if (!L) continue;
    if (s.anim) for (const ph of ['in', 'mid', 'out']) if (s.anim[ph]) {
      const cur = L.anim[ph];
      const np = s.anim[ph].preset;
      if (np && np !== cur.preset) {
        if (ph === 'in') delete cur.from; if (ph === 'out') delete cur.to;
        const d = ph === 'mid' ? null : PRESET[np];
        if (d) { if (d.duration) cur.duration = d.duration; if (d.stagger !== undefined) cur.stagger = d.stagger; if (d.by) cur.by = d.by; cur.ease = ''; }
        if (ph === 'mid') { cur.period = 0; cur.amount = 1; if (MID[np]?.color) cur.color = MID[np].color; }
      }
      deepMerge(cur, s.anim[ph]);
      if (ph !== 'mid' && !PRESET[cur.preset]) cur.preset = 'fade';
      if (ph === 'mid' && !MID[cur.preset]) cur.preset = 'none';
      if (L.type !== 'text' && ph !== 'mid') cur.by = 'all';
    }
    if (s.lights) deepMerge(L.lights, s.lights);
    if (Array.isArray(s.lines) && L.type === 'text') s.lines.forEach((ln, i) => { if (L.lines[i]) { if (typeof ln.delayIn === 'number') L.lines[i].delayIn = ln.delayIn; if (typeof ln.delayOut === 'number') L.lines[i].delayOut = ln.delayOut; } });
  }
  commit(); renderInspector();
}

document.addEventListener('selectionchange', () => {
  const ed = document.activeElement;
  if (ed && ed.id === 'editor' && sel()?.type === 'text') { const r = getSelectionOffsets(ed); if (r) lastRange = r; updateToolbar(sel()); }
});

// ---------------- keyboard ----------------
document.addEventListener('keydown', e => {
  const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $('#saveBtn').click(); return; }
  if (typing) return;
  const L = sel();
  if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && L) { e.preventDefault(); deleteLayer(L.id); }
  else if (mod && e.key.toLowerCase() === 'd' && L) { e.preventDefault(); duplicate(L); }
  else if (L && e.key.startsWith('Arrow')) {
    e.preventDefault(); const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') L.x -= d; if (e.key === 'ArrowRight') L.x += d; if (e.key === 'ArrowUp') L.y -= d; if (e.key === 'ArrowDown') L.y += d;
    commit({ redrawUI: false }); syncPosInputs();
  }
});

// ---------------- boot ----------------
function refreshAll() { refreshHeader(); syncBg(); renderLayerList(); renderInspector(); renderTimeline(); fit(); ensureFonts(P).then(() => { bumpFonts(); draw(); renderTimeline(); }); }
setAssetListener(() => { draw(); });
window.addEventListener('fonts-changed', () => { draw(); renderTimeline(); });
window.addEventListener('resize', fit);
new ResizeObserver(() => fit()).observe($('#stage'));

(async function boot() {
  await loadUserFonts();
  let loaded = null;
  try { const id = localStorage.getItem('as-last'); if (id) { const r = await store.get('projects', id); if (r) loaded = JSON.parse(r.data); } } catch {}
  P = loaded || newProject();
  selId = P.layers[P.layers.length - 1]?.id || null;
  lastSnap = snapshot();
  await loadSymbols();
  refreshAll();
  T = P.sections.intro; draw();
  window.studio = { get project() { return P; }, set t(v) { T = v; draw(); }, draw, select, refreshAll };
})();
