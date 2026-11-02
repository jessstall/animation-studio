// Font loading: Google Fonts on demand + fonts uploaded by the user (kept in the browser)
import { FONTS } from './model.js';
import { all, put, del } from './storage.js';
import { bumpFonts } from './render.js';
import { effectFonts } from './codelib.js';

const requested = new Set();
export const userFonts = []; // {id, family, weight, style}

function cssUrl(f, plain) {
  const fam = f.name.replace(/ /g, '+');
  return `https://fonts.googleapis.com/css2?family=${fam}${!plain && f.axes ? ':' + f.axes : ''}&display=block`;
}

export function requestFont(name) {
  if (requested.has(name)) return;
  requested.add(name);
  const f = FONTS.find(x => x.name === name);
  if (!f) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = cssUrl(f);
  link.onerror = () => { // fall back to the default style set if the style spec is rejected
    const l2 = document.createElement('link'); l2.rel = 'stylesheet'; l2.href = cssUrl(f, true); document.head.appendChild(l2);
  };
  document.head.appendChild(link);
}

// Make sure every face used in the project is loaded before drawing/exporting
export async function ensureFonts(project) {
  const faces = new Set();
  for (const l of project.layers) if (l.type === 'text') for (const line of l.lines) for (const r of line.runs) {
    requestFont(r.font);
    faces.add(`${r.italic ? 'italic ' : ''}${r.weight || 400} 64px "${r.font}"`);
  }
  for (const l of project.layers) if (l.type === 'code') for (const f of [...effectFonts(l), ...Object.values({ ...(l.paramDefs || {}), ...(l.params || {}) }).filter(v => typeof v === 'string' && FONTS.some(x => x.name === v))]) {
    requestFont(f);
    for (const w of [300, 400, 500, 600, 700]) { faces.add(`${w} 64px "${f}"`); faces.add(`italic ${w} 64px "${f}"`); }
  }
  // give stylesheets a moment to arrive, then load faces
  for (let i = 0; i < 30 && [...document.querySelectorAll('link[href*="fonts.googleapis"]')].some(l => !l.sheet); i++) await new Promise(r => setTimeout(r, 100));
  await Promise.all([...faces].map(f => document.fonts.load(f, 'AaÉg').catch(() => {})));
  await document.fonts.ready;
}

let bumpTimer;
document.fonts.addEventListener('loadingdone', () => { clearTimeout(bumpTimer); bumpTimer = setTimeout(() => { bumpFonts(); window.dispatchEvent(new Event('fonts-changed')); }, 30); });

// ---- uploaded fonts ----
function guessFace(fileName) {
  const n = fileName.replace(/\.(woff2?|ttf|otf)$/i, '');
  const lower = n.toLowerCase();
  const weights = [['thin', 100], ['extralight', 200], ['ultralight', 200], ['light', 300], ['regular', 400], ['book', 400], ['medium', 500], ['semibold', 600], ['demibold', 600], ['extrabold', 800], ['ultrabold', 800], ['black', 900], ['heavy', 900], ['bold', 700]];
  let weight = 400;
  for (const [k, w] of weights) if (lower.replace(/[-_ ]/g, '').includes(k)) { weight = w; break; }
  const style = /italic|oblique/.test(lower) ? 'italic' : 'normal';
  const family = n.replace(/[-_ ]?(thin|extra ?light|ultra ?light|light|regular|book|medium|semi ?bold|demi ?bold|extra ?bold|ultra ?bold|black|heavy|bold|italic|oblique)/gi, '').replace(/[-_]+/g, ' ').trim() || n;
  return { family, weight, style };
}

async function registerFace(rec) {
  const face = new FontFace(rec.family, rec.data, { weight: String(rec.weight), style: rec.style });
  await face.load();
  document.fonts.add(face);
  if (!userFonts.find(u => u.id === rec.id)) userFonts.push({ id: rec.id, family: rec.family, weight: rec.weight, style: rec.style });
}

export async function loadUserFonts() {
  try {
    const recs = await all('fonts');
    for (const r of recs) await registerFace(r).catch(() => {});
    bumpFonts();
  } catch (e) { console.warn(e); }
}

export async function addFontFile(file) {
  const data = await file.arrayBuffer();
  const g = guessFace(file.name);
  const rec = { id: g.family + '|' + g.weight + '|' + g.style, ...g, data, fileName: file.name };
  await registerFace(rec);
  await put('fonts', rec);
  bumpFonts();
  return rec;
}
export async function removeUserFont(id) {
  await del('fonts', id);
  const i = userFonts.findIndex(u => u.id === id); if (i >= 0) userFonts.splice(i, 1);
}
export const userFamilies = () => [...new Set(userFonts.map(u => u.family))];
