// Export: renders every frame at full size, then encodes transparent video with ffmpeg (WebAssembly).
import { renderFrame, imagesReady, pendingImages, bumpFonts } from './render.js';
import { ensureFonts } from './fonts.js';
import { totalDuration } from './model.js';
import { makeZip } from './zip.js';

const CORE_VERSION = '0.12.10';
// The ffmpeg core (~32 MB) is fetched from a CDN once and then cached by the browser.
const coreBase = () => new URLSearchParams(location.search).get('ffcore') || `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let ffmpeg = null;
async function prefetch(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Could not download the video encoder (' + r.status + ')');
  const reader = r.body.getReader(); let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; onProgress?.(got); }
}
async function getFFmpeg(onStatus) {
  if (ffmpeg) return ffmpeg;
  const { FFmpeg } = await import('../vendor/ffmpeg/index.js');
  const f = new FFmpeg();
  const base = coreBase();
  onStatus('Loading the video encoder (first time only, about 30 MB)…');
  // warm the browser cache with a progress readout, then load straight from the CDN
  await prefetch(`${base}/ffmpeg-core.wasm`, (got) => onStatus(`Loading the video encoder (first time only)… ${Math.min(99, Math.round(got / 32.2e6 * 100))}%`)).catch(() => {});
  onStatus('Starting the video encoder…');
  await f.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` });
  ffmpeg = f;
  return f;
}

export const slug = s => (s || 'animation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'animation';

export function segmentFrames(project) {
  const fps = project.fps, { intro, mid } = project.sections;
  const N = Math.round(totalDuration(project) * fps);
  const a = Math.round(intro * fps), b = Math.round((intro + mid) * fps);
  return { N, full: [0, N], intro: [0, a], mid: [a, b], outro: [b, N] };
}

// opts: { formats: {mov, webm, png}, segments: {full,intro,mid,outro}, onStatus, onProgress, signal }
export async function exportProject(project, opts) {
  const { onStatus = () => {}, onProgress = () => {} } = opts;
  const results = [];
  const fps = project.fps;
  const seg = segmentFrames(project);
  const name = slug(project.name);
  const needFF = opts.formats.mov || opts.formats.webm;

  onStatus('Preparing fonts and images…');
  await ensureFonts(project);
  await imagesReady(project);
  // warm-up: draw a few frames small so custom effects request everything they use, then wait for it
  if (project.layers.some(l => l.type === 'code')) {
    const wc = document.createElement('canvas'); wc.width = Math.round(project.width * 0.2); wc.height = Math.round(project.height * 0.2);
    const tot = totalDuration(project);
    for (let i = 0; i <= 12; i++) { try { renderFrame(wc.getContext('2d'), project, tot * i / 12, { scale: 0.2 }); } catch { } }
    await pendingImages(); await ensureFonts(project); bumpFonts();
  }

  let ff = null;
  if (needFF) ff = await getFFmpeg(onStatus);

  // ---- render frames ----
  const canvas = document.createElement('canvas');
  canvas.width = project.width; canvas.height = project.height;
  const ctx = canvas.getContext('2d');
  const pngs = [];
  for (let f = 0; f < seg.N; f++) {
    if (opts.signal?.aborted) throw new Error('Export cancelled');
    renderFrame(ctx, project, f / fps, { scale: 1, strict: true });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (ff) await ff.writeFile(`f${String(f).padStart(5, "0")}.png`, opts.formats.png ? buf.slice() : buf);
    if (opts.formats.png) pngs.push(buf);
    if (f % 3 === 0) { onStatus(`Drawing frames… ${f + 1} of ${seg.N}`); onProgress(0.4 * (f + 1) / seg.N); await new Promise(r => setTimeout(r)); }
  }

  const segs = ['full', 'intro', 'mid', 'outro'].filter(s => opts.segments[s] && seg[s][1] > seg[s][0]);
  const label = { full: 'full', intro: '1-intro', mid: '2-mid', outro: '3-outro' };
  const jobs = [];
  for (const s of segs) {
    if (opts.formats.mov) jobs.push({ s, ext: 'mov', mime: 'video/quicktime' });
    if (opts.formats.webm) jobs.push({ s, ext: 'webm', mime: 'video/webm' });
  }
  let done = 0;
  for (const j of jobs) {
    if (opts.signal?.aborted) throw new Error('Export cancelled');
    const [a, b] = seg[j.s];
    const out = `${name}-${label[j.s]}.${j.ext}`;
    onStatus(`Encoding ${out}…`);
    const handler = ({ progress }) => { if (progress >= 0 && progress <= 1) onProgress(0.4 + 0.6 * (done + progress) / jobs.length); };
    ff.on('progress', handler);
    const input = ['-framerate', String(fps), '-start_number', String(a), '-i', 'f%05d.png', '-frames:v', String(b - a)];
    const codec = j.ext === 'mov'
      ? ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', '-qscale:v', '6']
      : ['-c:v', 'libvpx', '-pix_fmt', 'yuva420p', '-crf', '8', '-b:v', '12M', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0'];
    await ff.exec([...input, ...codec, '-y', out]);
    ff.off('progress', handler);
    const data = await ff.readFile(out);
    await ff.deleteFile(out).catch(() => {});
    if (!data || !data.length) throw new Error(`Encoding ${out} failed`);
    results.push({ name: out, blob: new Blob([data.buffer], { type: j.mime }), segment: j.s, format: j.ext });
    done++;
  }
  if (ff) for (let f = 0; f < seg.N; f++) await ff.deleteFile(`f${String(f).padStart(5, '0')}.png`).catch(() => {});

  if (opts.formats.png) {
    onStatus('Bundling PNG frames…');
    const files = pngs.map((d, i) => {
      const part = i < seg.intro[1] ? '1-intro' : i < seg.mid[1] ? '2-mid' : '3-outro';
      return { name: `${name}-png/${part}/${name}-${String(i).padStart(5, '0')}.png`, data: d };
    });
    files.push({ name: `${name}-png/README.txt`, data: new TextEncoder().encode(`${project.width}x${project.height} at ${fps} fps, transparent PNG frames.\nIntro: frames ${seg.intro[0]}-${seg.intro[1] - 1}\nMid: frames ${seg.mid[0]}-${seg.mid[1] - 1}\nOutro: frames ${seg.outro[0]}-${seg.outro[1] - 1}\n`) });
    results.push({ name: `${name}-png-frames.zip`, blob: await makeZip(files), segment: 'full', format: 'png' });
  }
  onProgress(1);
  onStatus('Done');
  return results;
}

export async function zipResults(results, project) {
  return makeZip(results.map(r => ({ name: r.name, data: r.blob })));
}
