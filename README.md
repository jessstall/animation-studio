# Animation Studio

A browser app for designing animated text and symbol titles for social media videos, exported as **transparent video** in three pieces (intro, mid section, outro) so the editor can use the whole thing or trim the middle.

## What it does

- **Typography:** mixed fonts, weights, italics, sizes and colours within a line; per-line spacing, nudge and timing; alignment, line spacing, letter spacing. Google Fonts built in (the Will and the Way site fonts first), plus upload your own font files.
- **Drop shadow:** soft and centred by default, adjustable per layer.
- **Symbols:** the Will and the Way symbols are built in (`public/symbols/`), and you can add your own (kept in your browser). Any PNG/SVG can be dropped onto the canvas. Symbols can be recoloured.
- **Light:** an orb of light (colour, intensity, size) and rays (number, spread angle, direction, length, width, softness, turning) behind any layer, or as a light layer of its own.
- **Animation library:** intro/outro presets from simple (fade, rise, soft focus, wipe, radial reveal, typewriter) to lively (pop, bounce, cascade, wave) to magic (scatter, smoke, blown away, particles, text turning into birds that fly away), plus custom. Animate by whole block, line, word or letter, in any order.
- **Mid section effects:** still, pulse, breathe, float, sway, letter wave, glow, shimmer, candle flicker, slow turn.
- **Suggest:** describe the feel in words and Claude sets up the animation.
- **Export:** MOV (ProRes 4444 with alpha), WebM (VP8 with alpha) and PNG frames, for the full animation and each piece.
- Saves automatically in the browser; Open lists saved animations; projects can be downloaded/imported as files. Undo/redo.

Best used in Chrome on a computer.

## Hosting (Cloudflare Pages)

- Build command: *(none)*
- Build output directory: `public`
- The `functions/` folder is picked up automatically (it powers Suggest).
- For Suggest, add a secret `ANTHROPIC_API_KEY` in the Pages project (Settings → Variables and Secrets). Optional `ANTHROPIC_MODEL` overrides the model.

The video encoder (ffmpeg.wasm core, ~32 MB) loads from jsDelivr the first time someone exports, then the browser caches it.

## Adding Will and the Way symbols

Put the transparent PNG (or SVG) in `public/symbols/` and add an entry to `public/symbols/manifest.json`. Do this whenever a new course symbol is made for a Will and the Way landing page.

## Code map

- `public/js/model.js` – project structure, defaults, font list
- `public/js/anims.js` – easings, presets, mid-section effects
- `public/js/render.js` – text layout, animation evaluation, lights, particles and birds, frame drawing
- `public/js/editor.js` – the rich text editor
- `public/js/export.js` – frame rendering and ffmpeg encoding
- `public/js/main.js` – the interface
- `functions/api/suggest.js` – Suggest (calls Claude)
