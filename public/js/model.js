// Project model and defaults
export const uid = () => Math.random().toString(36).slice(2, 10);

export const SIZES = {
  portrait: { name: 'Portrait 9:16 (Reels, TikTok, Shorts)', w: 1080, h: 1920 },
  square: { name: 'Square 1:1', w: 1080, h: 1080 },
  feed: { name: 'Feed 4:5', w: 1080, h: 1350 },
  landscape: { name: 'Landscape 16:9', w: 1920, h: 1080 },
};

// Soft, centred, subtle — Jess's default
export const defaultShadow = () => ({ on: true, color: '#000000', opacity: 0.4, blur: 30, x: 0, y: 0 });

export const defaultLights = () => ({
  orb: { on: false, color: '#FFD98A', intensity: 0.7, size: 420, core: 0.5, x: 0, y: 0 },
  rays: { on: false, color: '#FFE3A0', intensity: 0.42, count: 12, spread: 360, direction: 0, length: 560, width: 0.5, softness: 6, turn: 4, inner: 60, x: 0, y: 0 },
});

export const defaultAnim = (kind = 'text') => ({
  in: { preset: kind === 'text' ? 'rise' : 'grow', start: 0, duration: kind === 'text' ? 0.8 : 1.0, stagger: kind === 'text' ? 0.08 : 0, by: kind === 'text' ? 'word' : 'all', dir: 'forward', ease: '' },
  mid: { preset: 'none', amount: 1, period: 0, color: '#FFE7A8' },
  out: { preset: 'fade', start: 0, duration: 0.6, stagger: 0, by: 'all', dir: 'forward', ease: '' },
});

export function newRun(text, base = {}) {
  return { text, font: 'Cormorant Garamond', weight: 500, italic: false, size: 96, color: '#FFFFFF', ...base };
}

export function newTextLayer(project, text = 'Your words here') {
  return {
    id: uid(), type: 'text', name: 'Text', visible: true,
    x: project.width / 2, y: project.height / 2, rotation: 0, scale: 1, opacity: 1,
    align: 'center', lineHeight: 1.15, tracking: 0,
    lines: text.split('\n').map(t => ({ runs: [newRun(t)], gap: 0, dx: 0, delayIn: 0, delayOut: 0 })),
    shadow: defaultShadow(), lights: defaultLights(), anim: defaultAnim('text'),
  };
}

export function newImageLayer(project, src, natW, natH, name = 'Image') {
  const w = Math.min(420, natW || 420);
  return {
    id: uid(), type: 'image', name, visible: true, src, natW, natH,
    x: project.width / 2, y: project.height / 2, width: w, rotation: 0, scale: 1, opacity: 1,
    tint: '', shadow: defaultShadow(), lights: defaultLights(), anim: defaultAnim('image'),
  };
}

export function newLightLayer(project) {
  const lights = defaultLights();
  lights.orb.on = true; lights.rays.on = true;
  const anim = defaultAnim('image');
  anim.in.preset = 'grow'; anim.in.duration = 1.4; anim.mid.preset = 'breathe';
  return {
    id: uid(), type: 'light', name: 'Light', visible: true,
    x: project.width / 2, y: project.height / 2, rotation: 0, scale: 1, opacity: 1,
    shadow: { ...defaultShadow(), on: false }, lights, anim,
  };
}

export function newCodeLayer(project, name, code) {
  const anim = defaultAnim('image'); anim.in.preset = 'none'; anim.out.preset = 'none';
  return {
    id: uid(), type: 'code', name: name || 'Custom effect', visible: true,
    x: project.width / 2, y: project.height / 2, rotation: 0, scale: 1, opacity: 1,
    code: code || '', prompts: [], shadow: { ...defaultShadow(), on: false }, lights: defaultLights(), anim,
  };
}

export function newProject() {
  const p = {
    version: 1, id: uid(), name: 'Untitled animation',
    width: 1080, height: 1920, fps: 30,
    sections: { intro: 1.6, mid: 3, outro: 1.4 },
    background: { mode: 'checker', image: '' },
    layers: [],
  };
  const t = newTextLayer(p, 'Will and the Way');
  t.lines[0].runs[0].size = 120;
  p.layers.push(t);
  return p;
}

export const totalDuration = p => p.sections.intro + p.sections.mid + p.sections.outro;

// Fonts: the ones used across willandtheway.com first, then a curated set.
// axes = the Google Fonts css2 style spec for that family.
export const FONTS = [
  // Will and the Way
  ['Cormorant Garamond', 'ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700', 'Will and the Way'],
  ['Mulish', 'ital,wght@0,200..1000;1,200..1000', 'Will and the Way'],
  ['Caveat', 'wght@400..700', 'Will and the Way'],
  ['Fraunces', 'ital,opsz,wght@0,9..144,100..900;1,9..144,100..900', 'Will and the Way'],
  ['Outfit', 'wght@100..900', 'Will and the Way'],
  ['Nunito Sans', 'ital,opsz,wght@0,6..12,200..1000;1,6..12,200..1000', 'Will and the Way'],
  ['Karla', 'ital,wght@0,200..800;1,200..800', 'Will and the Way'],
  ['Marcellus', '', 'Will and the Way'],
  ['Bebas Neue', '', 'Will and the Way'],
  ['Figtree', 'ital,wght@0,300..900;1,300..900', 'Will and the Way'],
  ['Big Shoulders Display', 'wght@100..900', 'Will and the Way'],
  ['Barlow', 'ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700', 'Will and the Way'],
  ['Barlow Condensed', 'ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600', 'Will and the Way'],
  ['Anton', '', 'Will and the Way'],
  ['Kaushan Script', '', 'Will and the Way'],
  // Serif
  ['Cormorant', 'ital,wght@0,300..700;1,300..700', 'Serif'],
  ['EB Garamond', 'ital,wght@0,400..800;1,400..800', 'Serif'],
  ['Playfair Display', 'ital,wght@0,400..900;1,400..900', 'Serif'],
  ['Bodoni Moda', 'ital,opsz,wght@0,6..96,400..900;1,6..96,400..900', 'Serif'],
  ['Lora', 'ital,wght@0,400..700;1,400..700', 'Serif'],
  ['Libre Baskerville', 'ital,wght@0,400;0,700;1,400', 'Serif'],
  ['DM Serif Display', 'ital@0;1', 'Serif'],
  ['Instrument Serif', 'ital@0;1', 'Serif'],
  ['Cinzel', 'wght@400..900', 'Serif'],
  ['Cinzel Decorative', 'wght@400;700;900', 'Serif'],
  ['Italiana', '', 'Serif'],
  ['Gloock', '', 'Serif'],
  ['Yeseva One', '', 'Serif'],
  ['Abril Fatface', '', 'Serif'],
  // Sans
  ['Inter', 'wght@100..900', 'Sans'],
  ['Montserrat', 'ital,wght@0,100..900;1,100..900', 'Sans'],
  ['Raleway', 'ital,wght@0,100..900;1,100..900', 'Sans'],
  ['Josefin Sans', 'ital,wght@0,100..700;1,100..700', 'Sans'],
  ['Poppins', 'ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600', 'Sans'],
  ['Tenor Sans', '', 'Sans'],
  ['Syne', 'wght@400..800', 'Sans'],
  ['Space Grotesk', 'wght@300..700', 'Sans'],
  ['Unbounded', 'wght@200..900', 'Sans'],
  ['League Spartan', 'wght@100..900', 'Sans'],
  ['Oswald', 'wght@200..700', 'Sans'],
  // Script
  ['Great Vibes', '', 'Script'],
  ['Allura', '', 'Script'],
  ['Pinyon Script', '', 'Script'],
  ['Parisienne', '', 'Script'],
  ['Sacramento', '', 'Script'],
  ['Dancing Script', 'wght@400..700', 'Script'],
].map(([name, axes, group]) => ({ name, axes, group }));
