// Rich text editor for a text layer: lines of styled runs (font, weight, italic, size, colour per character range).
import { newRun } from './model.js';

const STYLE_KEYS = ['font', 'weight', 'italic', 'size', 'color'];
const same = (a, b) => STYLE_KEYS.every(k => a[k] === b[k]);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const displaySize = s => Math.max(14, Math.min(42, s * 0.3));

export function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text && out.length) continue;
    const last = out[out.length - 1];
    if (last && same(last, r)) last.text += r.text; else out.push({ ...r });
  }
  if (!out.length) out.push({ ...runs[0], text: '' });
  return out;
}

function spanHTML(r) {
  const st = `font-family:'${r.font}',serif;font-weight:${r.weight};font-style:${r.italic ? 'italic' : 'normal'};color:${r.color};font-size:${displaySize(r.size)}px`;
  return `<span data-font="${esc(r.font)}" data-weight="${r.weight}" data-italic="${r.italic ? 1 : 0}" data-size="${r.size}" data-color="${r.color}" style="${st}">${esc(r.text) || ''}</span>`;
}

export function renderEditor(el, layer) {
  el.innerHTML = layer.lines.map(l => {
    const inner = l.runs.map(spanHTML).join('');
    return `<div>${l.runs.every(r => !r.text) ? l.runs.map(r => spanHTML(r).replace('></span>', '><br></span>')).join('') : inner}</div>`;
  }).join('');
}

function readStyle(node, base) {
  const st = { ...base };
  if (node.dataset) {
    const d = node.dataset;
    if (d.font) st.font = d.font;
    if (d.weight) st.weight = +d.weight;
    if (d.italic !== undefined) st.italic = d.italic === '1';
    if (d.size) st.size = +d.size;
    if (d.color) st.color = d.color;
  }
  return st;
}

// Parse the editor DOM into lines of runs
export function parseEditor(el, layer) {
  const base0 = layer.lines[0]?.runs[0] || newRun('');
  const lines = [];
  let cur = null;
  let lastStyle = { ...base0 };
  const start = () => { cur = []; lines.push(cur); };
  const walk = (node, st) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) {
        if (!cur) start();
        const text = ch.nodeValue.replace(/​/g, '');
        if (text) { cur.push({ ...st, text }); lastStyle = st; }
      } else if (ch.nodeName === 'BR') {
        if (!cur) start();
        cur.brSeen = true;
        if (ch.nextSibling || (ch.parentNode !== el && ch.parentNode.nextSibling)) { /* soft break inside a line */ }
      } else if (ch.nodeType === 1) {
        const s2 = readStyle(ch, st);
        if (ch.nodeName === 'DIV' || ch.nodeName === 'P') { start(); cur.style = s2; walk(ch, s2); cur = null; }
        else { if (!cur) start(); cur.style = cur.style || s2; walk(ch, s2); if (!ch.textContent) cur.emptyStyle = s2; }
      }
    }
  };
  walk(el, { ...base0 });
  if (!lines.length) lines.push([]);
  return lines.map((runs, i) => {
    const prev = layer.lines[i] || { gap: 0, dx: 0, delayIn: 0, delayOut: 0 };
    const fallback = runs.emptyStyle || runs.style || lastStyle;
    const rr = runs.length ? mergeRuns(runs) : [{ ...fallback, text: '' }];
    return { ...prev, runs: rr.map(r => ({ text: r.text, font: r.font, weight: r.weight, italic: !!r.italic, size: r.size, color: r.color })) };
  });
}

// --- selection as (global character offsets), lines joined with '\n' ---
function textNodesWithOffsets(el) {
  const out = []; let pos = 0;
  const divs = [...el.childNodes];
  divs.forEach((d, li) => {
    if (li > 0) pos += 1;
    const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
    if (d.nodeType === 3) { out.push({ node: d, start: pos }); pos += d.nodeValue.length; return; }
    let n; while ((n = walker.nextNode())) { out.push({ node: n, start: pos, line: li }); pos += n.nodeValue.length; }
    out.push({ lineEnd: true, el: d, start: pos, line: li });
  });
  return { list: out, total: pos };
}
function pointToOffset(el, node, offset) {
  const { list } = textNodesWithOffsets(el);
  if (node.nodeType === 3) { const h = list.find(x => x.node === node); return h ? h.start + offset : 0; }
  // element container: find first text node after the child index
  const child = node.childNodes[offset];
  const target = child || node;
  for (const x of list) {
    if (x.node && (target === x.node || target.contains?.(x.node))) return x.start;
    if (!child && x.lineEnd && (x.el === node || x.el.contains(node))) return x.start;
  }
  return list.length ? list[list.length - 1].start : 0;
}
export function getSelectionOffsets(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return null;
  const a = pointToOffset(el, r.startContainer, r.startOffset), b = pointToOffset(el, r.endContainer, r.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
export function setSelectionOffsets(el, { start, end }) {
  const { list } = textNodesWithOffsets(el);
  const find = (o) => {
    for (const x of list) if (x.node && o >= x.start && o <= x.start + x.node.nodeValue.length) return [x.node, o - x.start];
    for (const x of list) if (x.lineEnd && o <= x.start) return [x.el, x.el.childNodes.length];
    const last = list[list.length - 1];
    return last ? (last.node ? [last.node, last.node.nodeValue.length] : [last.el, last.el.childNodes.length]) : [el, 0];
  };
  const [sn, so] = find(start), [en, eo] = find(end);
  const r = document.createRange(); r.setStart(sn, so); r.setEnd(en, eo);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

// Apply a style change to the character range [start,end) across lines (global offsets). If empty range, whole layer.
export function applyStyle(layer, range, patch) {
  let pos = 0;
  const whole = !range || range.start === range.end;
  layer.lines.forEach((line, li) => {
    if (li > 0) pos += 1;
    const out = [];
    for (const r of line.runs) {
      const a = pos, b = pos + r.text.length;
      pos = b;
      if (whole) { out.push({ ...r, ...patch }); continue; }
      const s = Math.max(a, range.start), e = Math.min(b, range.end);
      if (e <= s) { out.push(r); continue; }
      if (s > a) out.push({ ...r, text: r.text.slice(0, s - a) });
      out.push({ ...r, ...patch, text: r.text.slice(s - a, e - a) });
      if (e < b) out.push({ ...r, text: r.text.slice(e - a) });
    }
    if (!line.runs.some(r => r.text) && !whole && range.start <= pos && range.end >= pos) line.runs = line.runs.map(r => ({ ...r, ...patch }));
    else line.runs = mergeRuns(out.length ? out : line.runs);
  });
}

// Style at the start of the selection (for toolbar display)
export function styleAt(layer, range) {
  let pos = 0;
  const o = range ? range.start : 0;
  for (let li = 0; li < layer.lines.length; li++) {
    if (li > 0) pos += 1;
    for (const r of layer.lines[li].runs) {
      if (o >= pos && o <= pos + r.text.length && (o < pos + r.text.length || !range || range.start === range.end)) return r;
      pos += r.text.length;
    }
  }
  return layer.lines[0].runs[0];
}
